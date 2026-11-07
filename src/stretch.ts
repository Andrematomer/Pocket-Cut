/**
 * Pitch-preserving time stretch (WSOLA: waveform-similarity overlap-add).
 * `speed` 2 = twice as fast (half as long), 0.5 = twice as slow. Pitch stays where it was.
 * The similarity search runs on a 4x decimated mono mix, then refines at full rate, which keeps
 * it fast enough for a phone.
 */
export function timeStretch(input: Float32Array[], sampleRate: number, speed: number, onProgress?: (done: number) => void): Float32Array[] {
  if (Math.abs(speed - 1) < 1e-3 || input.length === 0) return input;
  const n = input[0]!.length;
  const outLen = Math.max(1, Math.round(n / speed));
  const chs = input.length;

  let W = Math.round(sampleRate * 0.04);
  W += W % 2;
  const hop = W / 2; // synthesis hop
  const tol = Math.round(sampleRate * 0.012); // how far we may slide the analysis window
  const D = 4;

  const mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) {
    const ch = input[c]!;
    for (let i = 0; i < n; i++) mono[i]! += ch[i]! / chs;
  }
  const dn = Math.floor(n / D);
  const dec = new Float32Array(dn);
  for (let i = 0; i < dn; i++) {
    let s = 0;
    for (let j = 0; j < D; j++) s += mono[i * D + j]!;
    dec[i] = s / D;
  }

  const hann = new Float32Array(W);
  for (let i = 0; i < W; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / W);

  const out = input.map(() => new Float32Array(outLen + W));
  const norm = new Float32Array(outLen + W);

  const corr = (a: Float32Array, pa: number, b: Float32Array, pb: number, len: number, limit: number): number => {
    let s = 0;
    for (let i = 0; i < len; i++) {
      const ia = pa + i;
      const ib = pb + i;
      if (ia < 0 || ib < 0 || ia >= limit || ib >= limit) continue;
      s += a[ia]! * b[ib]!;
    }
    return s;
  };

  let prev = 0; // start of the previously used input window
  for (let k = 0, outPos = 0; outPos < outLen; k++, outPos = k * hop) {
    if (onProgress && (k & 127) === 0) onProgress(outPos / outLen);
    const nominal = Math.round(k * hop * speed);
    let best = nominal;
    if (k > 0) {
      const natural = prev + hop; // what would have followed the last window
      const lo = Math.max(0, nominal - tol);
      const hi = Math.min(n - 1, nominal + tol);
      // coarse search on the decimated signal
      const dl = Math.floor(hop / D);
      const dNat = Math.floor(natural / D);
      let bestD = Math.floor(nominal / D);
      let bestScore = -Infinity;
      for (let p = Math.floor(lo / D); p <= Math.floor(hi / D); p++) {
        const sc = corr(dec, p, dec, dNat, dl, dn);
        if (sc > bestScore) {
          bestScore = sc;
          bestD = p;
        }
      }
      // refine at full rate around the coarse winner
      let bestF = bestD * D;
      bestScore = -Infinity;
      for (let p = Math.max(lo, bestD * D - D); p <= Math.min(hi, bestD * D + D); p++) {
        const sc = corr(mono, p, mono, natural, hop, n);
        if (sc > bestScore) {
          bestScore = sc;
          bestF = p;
        }
      }
      best = bestF;
    }
    prev = best;
    for (let c = 0; c < chs; c++) {
      const src = input[c]!;
      const dst = out[c]!;
      for (let i = 0; i < W; i++) {
        const si = best + i;
        const di = outPos + i;
        if (di >= dst.length) break;
        if (si < n) dst[di]! += hann[i]! * src[si]!;
      }
    }
    for (let i = 0; i < W && outPos + i < norm.length; i++) norm[outPos + i]! += hann[i]!;
    if (best >= n) break;
  }

  return out.map((dst) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const w = norm[i]!;
      res[i] = w > 1e-3 ? dst[i]! / w : 0;
    }
    return res;
  });
}

/** Plays the sound faster or slower like a tape: the pitch follows the speed. Linear interpolation. */
export function resample(channels: Float32Array[], speed: number): Float32Array[] {
  if (Math.abs(speed - 1) < 1e-9) return channels;
  return channels.map((x) => {
    const n = Math.max(1, Math.floor(x.length / speed));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * speed;
      const k = Math.floor(p);
      const f = p - k;
      out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? x[k] ?? 0) * f;
    }
    return out;
  });
}
