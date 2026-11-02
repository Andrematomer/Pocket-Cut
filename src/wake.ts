/**
 * Keeps the screen awake while a long job runs. Uses the Screen Wake Lock API, asks for it again
 * when the page comes back to the front (the browser drops it whenever the page is hidden), and
 * falls back to a tiny muted video playing from a canvas stream where the API is missing.
 */
export interface WakeHandle {
  /** true while something is keeping the screen on */
  active(): boolean;
  release(): Promise<void>;
}

export async function keepAwake(): Promise<WakeHandle> {
  let lock: WakeLockSentinel | null = null;
  let video: HTMLVideoElement | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    try {
      if (navigator.wakeLock && (!lock || lock.released)) {
        lock = await navigator.wakeLock.request('screen');
        return;
      }
    } catch {
      lock = null;
    }
    if (!lock && !video) startVideo();
  };

  const startVideo = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d');
      const stream = (c as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream?.(2);
      if (!stream || !g) return;
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
      v.srcObject = stream;
      document.body.appendChild(v);
      let n = 0;
      const tick = setInterval(() => {
        g.fillStyle = n++ % 2 ? '#000' : '#010101';
        g.fillRect(0, 0, 16, 16);
      }, 500);
      (v as HTMLVideoElement & { _tick?: number })._tick = tick as unknown as number;
      void v.play().catch(() => {});
      video = v;
    } catch {
      video = null;
    }
  };

  const onVisible = () => void acquire();
  document.addEventListener('visibilitychange', onVisible);
  await acquire();

  return {
    active: () => !!(lock && !lock.released) || !!video,
    release: async () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      await lock?.release().catch(() => {});
      lock = null;
      if (video) {
        clearInterval((video as HTMLVideoElement & { _tick?: number })._tick);
        video.pause();
        video.srcObject = null;
        video.remove();
        video = null;
      }
    },
  };
}
