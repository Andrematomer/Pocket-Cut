import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { resample, timeStretch } from './stretch.ts';
import type { Clip } from './types.ts';

/**
 * Preview sound for clips that are not at normal speed. Browsers (iPhones especially) often drop or
 * mute the sound of a video playing at 0.25x or 3x, so the clip's sound is rendered once with the
 * same stretching the export uses, and played on its own next to the (silent) video.
 */
const cache = new Map<string, Promise<AudioBuffer | null>>();
const MAX_ENTRIES = 4;

export const keyOf = (c: Clip) => `${c.mediaId}|${c.start}|${c.end}|${c.speed}|${c.keepPitch}`;

export function bakedAudio(blob: Blob, clip: Clip): Promise<AudioBuffer | null> {
  const key = keyOf(clip);
  let p = cache.get(key);
  if (!p) {
    p = bake(blob, clip).catch(() => null);
    cache.set(key, p);
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function bake(blob: Blob, clip: Clip): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) return null;
    const rate = await at.getSampleRate();
    const chCount = Math.max(1, Math.min(2, await at.getNumberOfChannels()));
    const len = Math.max(1, Math.round((clip.end - clip.start) * rate));
    const chans = Array.from({ length: chCount }, () => new Float32Array(len));
    for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers(clip.start, clip.end)) {
      const off = Math.round((timestamp - clip.start) * rate);
      for (let c = 0; c < chCount; c++) {
        const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const from = Math.max(0, -off);
        const to = Math.max(0, off);
        const n = Math.min(data.length - from, len - to);
        if (n > 0) chans[c]!.set(data.subarray(from, from + n), to);
      }
    }
    const out = clip.keepPitch ? timeStretch(chans, rate, clip.speed) : resample(chans, clip.speed);
    const ab = new AudioBuffer({ length: out[0]!.length, numberOfChannels: chCount, sampleRate: rate });
    out.forEach((d, c) => ab.copyToChannel(d as Float32Array<ArrayBuffer>, c));
    return ab;
  } finally {
    input.dispose();
  }
}
