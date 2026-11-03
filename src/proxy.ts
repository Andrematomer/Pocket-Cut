import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality, canEncodeAudio, getFirstEncodableVideoCodec } from 'mediabunny';
import { clearProxy, mediaEntry, setProxy } from './media.ts';
import { saveMedia } from './persist.ts';
import { awakeForJob } from './wake.ts';
import type { MediaInfo } from './types.ts';

/**
 * Preview copies. Phones can struggle to play big (4K, HEVC, 60 fps) files inside a web page while also
 * painting them to a canvas, which shows up as a slideshow with cut-off sound. So each video also gets a
 * small, easy-to-play copy (about 360 px, 30 fps, a key frame every second) that only the on-screen preview
 * uses. Export always reads the original file.
 */
const queue: { id: string; info: MediaInfo; long: number }[] = [];
/** bumped when the preview size changes: running work for the old size is dropped */
let generation = 0;
let order: () => string[] = () => [];
let progress: (id: string, p: number | null) => void = () => {};
let changed: () => void = () => {};

/** the media ids in the order their copies should be made (selected clip first) */
export const setProxyOrder = (f: () => string[]): void => {
  order = f;
};
export const onProxyProgress = (f: (id: string, p: number | null) => void): void => {
  progress = f;
};
/** called when a copy appeared or went away: whatever the player has loaded may be stale */
export const onProxyChange = (f: () => void): void => {
  changed = f;
};
let running = false;
let listener: (working: boolean) => void = () => {};

export const onProxyWork = (f: (working: boolean) => void): void => {
  listener = f;
};

/** true when a preview copy would help: only big pictures are worth it */
export const wantsProxy = (info: MediaInfo, long = 360): boolean => info.kind !== 'image' && Math.max(info.width, info.height) > long * 1.4;

/** `long` is the size (long side, pixels) of the copy; smaller copies play more smoothly on weak phones. */
export function queueProxy(id: string, info: MediaInfo, long: number): void {
  if (!wantsProxy(info, long) || queue.some((q) => q.id === id)) return;
  queue.push({ id, info, long });
  progress(id, 0);
  void drain();
}

/** The preview size was changed: drop the old copies and make them again. */
export function requeueAllProxies(media: Record<string, MediaInfo>, long = loadLong()): void {
  generation++;
  for (const q of queue.splice(0)) progress(q.id, null);
  for (const [id, info] of Object.entries(media)) {
    if (clearProxy(id)) queueProxy(id, info, long);
  }
  changed();
}
const loadLong = (): number => {
  try {
    return (JSON.parse(localStorage.getItem('pocket-cut:app-settings') ?? '{}') as { previewLong?: number }).previewLong ?? 240;
  } catch {
    return 240;
  }
};

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  listener(true);
  const wake = await awakeForJob().catch(() => null);
  try {
    while (queue.length) {
      // the clip being edited first, then the rest in timeline order
      const want = order();
      let at = 0;
      let rank = Infinity;
      queue.forEach((q, i) => {
        const r = want.indexOf(q.id);
        const rr = r < 0 ? want.length : r;
        if (rr < rank) (rank = rr), (at = i);
      });
      const job = queue.splice(at, 1)[0]!;
      const gen = generation;
      const e = mediaEntry(job.id);
      if (!e || e.proxy) {
        progress(job.id, null);
        continue;
      }
      try {
        const blob = await makeProxy(e.blob, job.info, job.long, () => !mediaEntry(job.id) || gen !== generation, (p) => progress(job.id, p));
        if (!blob) console.info('preview copy skipped (no suitable encoder)');
        if (blob && gen === generation && setProxy(job.id, blob)) {
          void saveMedia(job.id, { blob: e.blob, name: e.name, thumb: e.thumb, proxy: blob });
          changed();
        }
      } catch (err) {
        console.warn('preview copy not made:', err); // the original keeps playing
      } finally {
        progress(job.id, null);
      }
    }
  } finally {
    await wake?.release().catch(() => {});
    running = false;
    listener(false);
  }
}

async function makeProxy(source: Blob, info: MediaInfo, long: number, cancelled: () => boolean, report: (p: number) => void): Promise<Blob | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  // H.264 plays everywhere; VP9 only as a fallback where there is no H.264 encoder (it plays in the browsers that offer it)
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: 640, height: 360, frameRate: 30, quality: new Quality({ bitrate: 800_000 }) }).catch(() => null);
  if (!codec) return null;
  // sound must be copied too, or the preview would be silent: no AAC encoder means no preview copy
  if (info.hasAudio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 64_000 }) }).catch(() => false))) return null;
  const k = long / Math.max(info.width, info.height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const conv = await Conversion.init({
      input,
      output,
      showWarnings: false,
      video: { width: even(info.width * k), height: even(info.height * k), fit: 'fill', codec, quality: new Quality({ bitrate: 800_000 }), frameRate: 30, keyFrameInterval: 1 },
      audio: info.hasAudio ? { codec: 'aac', quality: new Quality({ bitrate: 64_000 }) } : { discard: true },
    });
    if (!conv.isValid) return null;
    conv.onProgress = (p) => report(p);
    const watch = setInterval(() => cancelled() && void conv.cancel(), 1000);
    try {
      await conv.execute();
    } finally {
      clearInterval(watch);
    }
    return target.buffer ? new Blob([target.buffer], { type: 'video/mp4' }) : null;
  } finally {
    input.dispose();
  }
}
