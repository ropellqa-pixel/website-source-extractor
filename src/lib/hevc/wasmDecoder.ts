/**
 * Тонкая обёртка над WASM-декодером H.265 (libhevc из @hevcjs/core, лицензия MIT).
 * Работает в фоновом потоке: feed() — порция видеопотока, drain() — готовые кадры в порядке показа.
 * Кадры возвращаются сразу в 8 битах (камеры пишут 8-битный H.265), чтобы не гонять лишнюю память.
 */
interface EmModule {
  cwrap: (name: string, ret: string | null, args: string[]) => (...a: number[]) => number;
  _malloc: (n: number) => number;
  _free: (p: number) => void;
  getValue: (p: number, t: string) => number;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
}

export interface Frame8 {
  y: Uint8Array; u: Uint8Array; v: Uint8Array;
  width: number; height: number; cw: number; ch: number;
}

type Factory = (opts: Record<string, unknown>) => Promise<EmModule>;

export class WasmHevcDecoder {
  private m: EmModule;
  private dec: number;
  private api: Record<string, (...a: number[]) => number>;

  private constructor(m: EmModule) {
    this.m = m;
    this.api = {
      create: m.cwrap('hevc_decoder_create', 'number', []),
      destroy: m.cwrap('hevc_decoder_destroy', null, ['number']),
      feed: m.cwrap('hevc_decoder_feed', 'number', ['number', 'number', 'number']),
      drain: m.cwrap('hevc_decoder_drain', 'number', ['number', 'number']),
      getDrained: m.cwrap('hevc_decoder_get_drained_frame', 'number', ['number', 'number', 'number']),
    };
    this.dec = this.api.create();
    if (!this.dec) throw new Error('Не удалось создать декодер');
  }

  static async create(factory: Factory, wasmUrl: string): Promise<WasmHevcDecoder> {
    const m = await factory({ locateFile: () => wasmUrl });
    return new WasmHevcDecoder(m);
  }

  feed(data: Uint8Array) {
    const p = this.m._malloc(data.length);
    try {
      this.m.HEAPU8.set(data, p);
      this.api.feed(this.dec, p, data.length);
    } finally {
      this.m._free(p);
    }
  }

  drain(): Frame8[] {
    const m = this.m;
    const cnt = m._malloc(4);
    const fp = m._malloc(48);
    const out: Frame8[] = [];
    try {
      if (this.api.drain(this.dec, cnt) !== 0) return out;
      const n = m.getValue(cnt, 'i32');
      for (let i = 0; i < n; i++) {
        if (this.api.getDrained(this.dec, i, fp) !== 0) continue;
        const w = m.getValue(fp + 12, 'i32'), h = m.getValue(fp + 16, 'i32');
        const sy = m.getValue(fp + 20, 'i32'), sc = m.getValue(fp + 24, 'i32');
        const cw = m.getValue(fp + 28, 'i32'), ch = m.getValue(fp + 32, 'i32');
        out.push({
          y: this.plane(m.getValue(fp, '*'), w, h, sy),
          u: this.plane(m.getValue(fp + 4, '*'), cw, ch, sc),
          v: this.plane(m.getValue(fp + 8, '*'), cw, ch, sc),
          width: w, height: h, cw, ch,
        });
      }
    } finally {
      m._free(fp);
      m._free(cnt);
    }
    return out;
  }

  private plane(ptr: number, w: number, h: number, stride: number): Uint8Array {
    const src = this.m.HEAPU16;
    const out = new Uint8Array(w * h);
    let base = ptr >> 1;
    let o = 0;
    for (let row = 0; row < h; row++, base += stride) {
      for (let x = 0; x < w; x++) out[o++] = src[base + x];
    }
    return out;
  }

  reset() {
    try { this.api.destroy(this.dec); } catch { /* */ }
    this.dec = this.api.create();
    if (!this.dec) throw new Error('Не удалось создать декодер');
  }

  destroy() {
    try { this.api.destroy(this.dec); } catch { /* */ }
  }
}