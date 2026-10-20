import { NEW_API, isNewHosting } from '@/lib/apiUrls';

const MAX_PARALLEL = 2;
const MIN_GAP_MS = 120;
const RETRY_DELAYS = [700, 1500, 2500, 3500, 5000, 7000];

let active = 0;
let lastStart = 0;
let pausedUntil = 0;
const waiting: Array<() => void> = [];

function pump() {
  if (!waiting.length || active >= MAX_PARALLEL) return;
  const wait = Math.max(pausedUntil, lastStart + MIN_GAP_MS) - Date.now();
  if (wait > 0) { setTimeout(pump, wait); return; }
  active++;
  lastStart = Date.now();
  waiting.shift()!();
  pump();
}

function slot(): Promise<void> {
  return new Promise(resolve => { waiting.push(resolve); pump(); });
}

function release() {
  active--;
  pump();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function installApiQueue() {
  if (typeof window === 'undefined' || !isNewHosting()) return;
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || NEW_API;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(base)) return original(input, init);

    for (let attempt = 0; ; attempt++) {
      await slot();
      try {
        const res = await original(input, init);
        if ((res.status === 503 || res.status === 429 || res.status === 502) && attempt < RETRY_DELAYS.length) {
          pausedUntil = Date.now() + RETRY_DELAYS[attempt];
          continue;
        }
        return res;
      } catch (e) {
        if (init?.signal?.aborted || attempt >= RETRY_DELAYS.length) throw e;
        pausedUntil = Date.now() + RETRY_DELAYS[attempt];
        await sleep(0);
      } finally {
        release();
      }
    }
  };
}
