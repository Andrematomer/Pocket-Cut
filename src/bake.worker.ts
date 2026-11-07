import { resample, timeStretch } from './stretch.ts';

/** Stretches or resamples sound away from the main thread, so the screen never freezes while it is made. */
self.onmessage = (e: MessageEvent<{ id: number; chans: Float32Array[]; rate: number; speed: number; keepPitch: boolean }>) => {
  const { id, chans, rate, speed, keepPitch } = e.data;
  let last = 0;
  const out = keepPitch
    ? timeStretch(chans, rate, speed, (f) => {
        const now = performance.now();
        if (now - last > 120) {
          last = now;
          (self as unknown as Worker).postMessage({ id, progress: f });
        }
      })
    : resample(chans, speed);
  (self as unknown as Worker).postMessage({ id, out }, out.map((o) => o.buffer));
};
