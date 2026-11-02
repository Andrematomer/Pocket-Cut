import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality, canEncodeAudio, getFirstEncodableVideoCodec } from 'mediabunny';
import { mediaEntry, setProxy } from './media.ts';
import { saveMedia } from './persist.ts';
import type { MediaInfo } from './types.ts';

/**
 * Preview copies. Phones can struggle to play big (4K, HEVC, 60 fps) files inside a web page while also
 * painting them to a canvas, which shows up as a slideshow with cut-off sound. So each video also gets a
 * small, easy-to-play copy (about 360 px, 30 fps, a key frame every second) that only the on-screen preview
 * uses. Export always reads the original file.
 */
const LONG_SIDE = 360;
const queue: { id: string; info: MediaInfo; done: () => void }[] = [];
let running = false;
let listener: (working: boolean) => void = () => {};

export const onProxyWork = (f: (working: boolean) => void): void => {
  listener = f;
};

/** true when a preview copy would help: only big pictures are worth it */
export const wantsProxy = (info: MediaInfo): boolean => info.kind !== 'image' && Math.max(info.width, info.height) > 540;

export function queueProxy(id: string, info: MediaInfo): void {
  if (!wantsProxy(info) || queue.some((q) => q.id === id)) return;
  queue.push({ id, info, done: () => {} });
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  listener(true);
  try {
    while (queue.length) {
      const job = queue.shift()!;
      const e = mediaEntry(job.id);
      if (!e || e.proxy) continue;
      try {
        const blob = await makeProxy(e.blob, job.info, () => !mediaEntry(job.id));
        if (!blob) console.info('preview copy skipped (no suitable encoder)');
        if (blob && setProxy(job.id, blob)) void saveMedia(job.id, { blob: e.blob, name: e.name, thumb: e.thumb, proxy: blob });
      } catch (err) {
        console.warn('preview copy not made:', err); // the original keeps playing
      }
    }
  } finally {
    running = false;
    listener(false);
  }
}

async function makeProxy(source: Blob, info: MediaInfo, cancelled: () => boolean): Promise<Blob | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  // H.264 plays everywhere; VP9 only as a fallback where there is no H.264 encoder (it plays in the browsers that offer it)
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: 640, height: 360, frameRate: 30, quality: new Quality({ bitrate: 800_000 }) }).catch(() => null);
  if (!codec) return null;
  // sound must be copied too, or the preview would be silent: no AAC encoder means no preview copy
  if (info.hasAudio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate: 64_000 }) }).catch(() => false))) return null;
  const k = LONG_SIDE / Math.max(info.width, info.height);
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
