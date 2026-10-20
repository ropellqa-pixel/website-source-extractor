import { NEW_API, isNewHosting } from '@/lib/apiUrls';

const BURST = 4;
const REFILL_MS = 850;
const MAX_PARALLEL = 3;
const RETRY_DELAYS = [900, 1500, 2500, 4000, 6000];

let tokens = BURST;
let lastRefill = Date.now();
let active = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const waiting: Array<{ resolve: () => void; urgent: boolean }> = [];

function refill() {
  const now = Date.now();
  const add = Math.floor((now - lastRefill) / REFILL_MS);
  if (add > 0) {
    tokens = Math.min(BURST, tokens + add);
    lastRefill += add * REFILL_MS;
  }
  if (tokens >= BURST) lastRefill = now;
}

function pump() {
  refill();
  while (waiting.length && tokens > 0 && active < MAX_PARALLEL) {
    tokens--;
    active++;
    const idx = waiting.findIndex(w => w.urgent);
    const [next] = waiting.splice(idx >= 0 ? idx : 0, 1);
    next.resolve();
  }
  if (waiting.length && !timer) {
    const wait = tokens > 0 ? 50 : Math.max(30, lastRefill + REFILL_MS - Date.now());
    timer = setTimeout(() => { timer = null; pump(); }, wait);
  }
}

function slot(urgent: boolean): Promise<void> {
  return new Promise(resolve => { waiting.push({ resolve, urgent }); pump(); });
}

function release() {
  active--;
  pump();
}

function penalize() {
  tokens = 0;
  lastRefill = Date.now();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const BACKGROUND = /"action":"(notices|enroll_poll|chat_mark_read|heartbeat)"/;

export function installApiQueue() {
  if (typeof window === 'undefined' || !isNewHosting()) return;
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || NEW_API;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) return original(input, init);
    const body = typeof init?.body === 'string' ? init.body : '';
    const urgent = !BACKGROUND.test(body) && !/chat_rooms|chat_messages/.test(body);

    for (let attempt = 0; ; attempt++) {
      await slot(urgent);
      let retry = false;
      try {
        const res = await original(input, init);
        if ((res.status === 503 || res.status === 429 || res.status === 502) && attempt < RETRY_DELAYS.length) {
          penalize();
          retry = true;
        } else {
          return res;
        }
      } catch (e) {
        if (init?.signal?.aborted || attempt >= RETRY_DELAYS.length) throw e;
        penalize();
        retry = true;
      } finally {
        release();
      }
      if (retry) await sleep(RETRY_DELAYS[attempt]);
    }
  };
}
