import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { resample, timeStretch } from './stretch.ts';
import type { Clip } from './types.ts';

/**
 * Preview sound for clips that are not at normal speed. Browsers (iPhones especially) often drop or
 * mute the sound of a video playing at 0.25x or 3x, so the clip's sound is rendered once with the
 * same stretching the export uses, and played on its own next to the (silent) video.
 */
const cache = new Map<string, Promise<AudioBuffer | null>>();
const MAX_ENTRIES = 12;

/** how far each sound being made is (0..1), by bake key; the timeline greys those strips and shows a pie */
export const progress = new Map<string, number>();
const listeners = new Set<() => void>();
let notified = 0;
export const onBakeChange = (f: () => void): void => void listeners.add(f);
function report(key: string, v: number | null, force = false): void {
  if (v === null) progress.delete(key);
  else progress.set(key, v);
  const now = performance.now();
  if (!force && now - notified < 100) return;
  notified = now;
  listeners.forEach((f) => f());
}

let worker: Worker | null | undefined;
let jobs = 0;
function stretchAway(chans: Float32Array[], rate: number, clip: Clip, onProgress: (f: number) => void): Promise<Float32Array[]> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
  }
  const w = worker;
  if (!w) return Promise.resolve(clip.keepPitch ? timeStretch(chans, rate, clip.speed) : resample(chans, clip.speed));
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<{ id: number; out?: Float32Array[]; progress?: number }>) => {
      if (e.data.id !== id) return;
      if (e.data.out) {
        w.removeEventListener('message', on);
        resolve(e.data.out);
      } else if (e.data.progress !== undefined) onProgress(e.data.progress);
    };
    w.addEventListener('message', on);
    w.addEventListener('error', () => reject(new Error('worker')), { once: true });
    w.postMessage({ id, chans, rate, speed: clip.speed, keepPitch: clip.keepPitch }, chans.map((c) => c.buffer));
  });
}

export const keyOf = (c: Clip) => `${c.mediaId}|${c.start}|${c.end}|${c.speed}|${c.keepPitch}`;

export function bakedAudio(blob: Blob, clip: Clip): Promise<AudioBuffer | null> {
  const key = keyOf(clip);
  let p = cache.get(key);
  if (!p) {
    report(key, 0, true);
    p = bake(blob, clip, key)
      .catch(() => null)
      .finally(() => report(key, null, true));
    cache.set(key, p);
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function bake(blob: Blob, clip: Clip, key: string): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) return null;
    const rate = await at.getSampleRate();
    const chCount = Math.max(1, Math.min(2, await at.getNumberOfChannels()));
    const len = Math.max(1, Math.round((clip.end - clip.start) * rate));
    const chans = Array.from({ length: chCount }, () => new Float32Array(len));
    const slow = Math.abs(clip.speed - 1) >= 1e-3; // sound at normal speed needs no stretching: decoding is all there is
    for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers(clip.start, clip.end)) {
      report(key, Math.min(1, (timestamp - clip.start) / Math.max(0.01, clip.end - clip.start)) * (slow ? 0.4 : 1));
      const off = Math.round((timestamp - clip.start) * rate);
      for (let c = 0; c < chCount; c++) {
        const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const from = Math.max(0, -off);
        const to = Math.max(0, off);
        const n = Math.min(data.length - from, len - to);
        if (n > 0) chans[c]!.set(data.subarray(from, from + n), to);
      }
    }
    const out = slow ? await stretchAway(chans, rate, clip, (f) => report(key, 0.4 + f * 0.6)) : chans;
    const ab = new AudioBuffer({ length: out[0]!.length, numberOfChannels: chCount, sampleRate: rate });
    out.forEach((d, c) => ab.copyToChannel(d as Float32Array<ArrayBuffer>, c));
    return ab;
  } finally {
    input.dispose();
  }
}
