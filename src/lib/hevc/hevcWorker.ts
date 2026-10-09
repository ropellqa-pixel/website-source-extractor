/// <reference lib="webworker" />
/**
 * Фоновый поток живого видео камеры: качает HLS, достаёт H.265 и декодирует его в WebAssembly.
 * Нужен там, где браузер не умеет H.265 сам (встроенный браузер АБИЗ, Chrome/Edge без кодека).
 * Кадры (YUV 4:2:0, 8 бит) отправляются на страницу и рисуются на canvas через WebGL.
 */
import { extractHevcFromTs } from './tsDemux';
import { WasmHevcDecoder } from './wasmDecoder';

declare const self: DedicatedWorkerGlobalScope & { HEVCDecoderModule?: unknown };

let decoder: WasmHevcDecoder | null = null;
let running = false;
let generation = 0;
let backlog = 0;

function post(msg: unknown, transfer: Transferable[] = []) { self.postMessage(msg, transfer); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { cache: 'no-store', signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function loop(url: string, gen: number, live: boolean) {
  const seen = new Set<string>();
  let errors = 0;
  let first = true;
  let pace = 1000 / 12;
  let lastNew = Date.now();
  while (running && gen === generation) {
    try {
      // Плейлист облако обычно отдаёт за 10–50 мс; если запрос «повис» — бросаем его через 2,5 с
      // и сразу спрашиваем снова (а не ждём 8 с): видео в запасе продолжает идти.
      const r = await fetchWithTimeout(url, 2500);
      // Ссылка устарела (облако отвечает ошибкой) — сразу просим новую, не ждём повторов.
      if (!r.ok && first) { post({ type: 'error', message: 'playlist ' + r.status }); running = false; return; }
      if (!r.ok) throw new Error('playlist ' + r.status);
      const text = await r.text();
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      const segs: { url: string; dur: number }[] = [];
      let dur = 1;
      for (const raw of text.split('\n')) {
        const l = raw.trim();
        if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) || 1;
        else if (l && !l.startsWith('#')) segs.push({ url: l.startsWith('http') ? l : base + l, dur });
      }
      // Эфир: на старте два последних куска — картинка появляется сразу и есть запас на загрузку
      // следующего. Архив — все куски по порядку.
      const todo = first && live ? segs.slice(-3) : segs.filter(s => !seen.has(s.url));
      if (first && live) segs.forEach(s => seen.add(s.url));
      const ended = !live && text.includes('#EXT-X-ENDLIST');
      for (const s of todo) {
        if (!running || gen !== generation) return;
        seen.add(s.url);
        lastNew = Date.now();
        let sr: Response | null = null;
        for (let a = 0; a < 3 && !sr; a++) {
          try { sr = await fetchWithTimeout(s.url, 4000); } catch { /* повтор */ }
        }
        if (!sr) continue;
        if (!sr.ok || !decoder) continue;
        const es = extractHevcFromTs(new Uint8Array(await sr.arrayBuffer()));
        if (!es.length) continue;
        decoder.feed(es);
        const frames = decoder.drain();
        if (frames.length) pace = Math.min(250, Math.max(25, (s.dur * 1000) / frames.length));
        for (const f of frames) {
          if (!running || gen !== generation) return;
          backlog++;
          post({ type: 'frame', w: f.width, h: f.height, cw: f.cw, ch: f.ch, y: f.y, u: f.u, v: f.v, pace },
            [f.y.buffer, f.u.buffer, f.v.buffer]);
          if (first) { first = false; post({ type: 'playing' }); }
        }
        first = false;
      }
      if (ended && todo.length === 0) { post({ type: 'ended' }); return; }
      // Эфир «замёрз» (облако перестало давать новые куски) — просим страницу взять свежую ссылку.
      if (live && Date.now() - lastNew > (first ? 10000 : 20000)) { post({ type: 'error', message: 'stalled' }); running = false; return; }
      if (!live) {
        // Архив качаем с опережением, но не забиваем память: ждём, пока страница покажет кадры.
        while (backlog > 120 && running && gen === generation) await sleep(200);
      }
      if (seen.size > 400) { const keep = new Set(segs.map(s => s.url)); seen.clear(); keep.forEach(k => seen.add(k)); }
      errors = 0;
      // Новый кусок появляется раз в 1–3 с — спрашиваем почаще, чтобы забрать его сразу.
      await sleep(todo.length ? 300 : 450);
    } catch (e) {
      // Обрывы и «зависания» облака — частые и короткие. Переподключаемся с новой ссылкой
      // только если связи нет ~15 с подряд; до этого просто повторяем, картинка идёт из запаса.
      errors++;
      if (errors >= 8) { post({ type: 'error', message: String(e) }); running = false; return; }
      await sleep(errors < 3 ? 200 : 1000);
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'start') {
    try {
      if (!decoder) {
        importScripts(m.glueUrl);
        const factory = self.HEVCDecoderModule as Parameters<typeof WasmHevcDecoder.create>[0];
        decoder = await WasmHevcDecoder.create(factory, m.wasmUrl);
      }
      generation++;
      running = true;
      backlog = 0;
      loop(m.url, generation, m.live !== false);
    } catch (err) {
      post({ type: 'error', message: 'Декодер не загрузился: ' + String(err) });
    }
  } else if (m.type === 'shown') {
    backlog = Math.max(0, backlog - (m.n || 1));
  } else if (m.type === 'stop') {
    running = false;
    generation++;
    decoder?.destroy();
    decoder = null;
    self.close();
  }
};
