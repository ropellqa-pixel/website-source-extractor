/**
 * Минимальный разбор MPEG-TS (кусков HLS) — достаёт сырой видеопоток H.265 (Annex-B).
 * Камеры отдают TS с одной видео- и одной аудиодорожкой; звук нам не нужен.
 */
export function extractHevcFromTs(ts: Uint8Array): Uint8Array {
  const PKT = 188;
  let pmtPid = -1;
  let videoPid = -1;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let collecting = false;
  let pesBuf: Uint8Array[] = [];
  let pesLen = 0;

  const flushPes = () => {
    if (!pesBuf.length) return;
    const pes = new Uint8Array(pesLen);
    let o = 0;
    for (const p of pesBuf) { pes.set(p, o); o += p.length; }
    pesBuf = []; pesLen = 0;
    if (pes.length < 9 || pes[0] !== 0 || pes[1] !== 0 || pes[2] !== 1) return;
    const hdrLen = pes[8];
    const payload = pes.subarray(9 + hdrLen);
    chunks.push(payload);
    total += payload.length;
  };

  let start = 0;
  while (start < ts.length && ts[start] !== 0x47) start++;
  for (let i = start; i + PKT <= ts.length; i += PKT) {
    if (ts[i] !== 0x47) continue;
    const pusi = (ts[i + 1] & 0x40) !== 0;
    const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    const afc = (ts[i + 3] >> 4) & 3;
    let off = i + 4;
    if (afc === 2) continue;
    if (afc === 3) off += 1 + ts[i + 4];
    if (off >= i + PKT) continue;
    const payload = ts.subarray(off, i + PKT);

    if (pid === 0 && pmtPid < 0) {
      const p = payload.subarray(pusi ? 1 + payload[0] : 0);
      const secLen = ((p[1] & 0x0f) << 8) | p[2];
      for (let k = 8; k + 4 <= 3 + secLen - 4; k += 4) {
        const prog = (p[k] << 8) | p[k + 1];
        if (prog !== 0) { pmtPid = ((p[k + 2] & 0x1f) << 8) | p[k + 3]; break; }
      }
      continue;
    }
    if (pid === pmtPid && videoPid < 0) {
      const p = payload.subarray(pusi ? 1 + payload[0] : 0);
      const secLen = ((p[1] & 0x0f) << 8) | p[2];
      const progInfoLen = ((p[10] & 0x0f) << 8) | p[11];
      let k = 12 + progInfoLen;
      const end = 3 + secLen - 4;
      while (k + 5 <= end) {
        const type = p[k];
        const epid = ((p[k + 1] & 0x1f) << 8) | p[k + 2];
        const esInfo = ((p[k + 3] & 0x0f) << 8) | p[k + 4];
        if (type === 0x24 || type === 0x1b) { videoPid = epid; break; }
        k += 5 + esInfo;
      }
      continue;
    }
    if (pid === videoPid) {
      if (pusi) { if (collecting) flushPes(); collecting = true; }
      if (collecting) { pesBuf.push(payload); pesLen += payload.length; }
    }
  }
  if (collecting) flushPes();

  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
