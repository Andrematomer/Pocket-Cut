import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type InputAudioTrack,
  type WrappedCanvas,
} from 'mediabunny';
import { videoBitrate } from './bitrate.ts';
import { mediaBitmap } from './media.ts';
import { drawFrame, outputSize } from './geometry.ts';
import { resample, timeStretch } from './stretch.ts';
import { awakeForJob } from './wake.ts';
import { activeAt, clipDuration, planParts, sourceAt, sourceTimeAt, totalOf, type Part } from './timeline.ts';
import type { Clip, Project } from './types.ts';

/** Shown to people instead of codec jargon. */
export class FriendlyError extends Error {}

export interface ExportProgress {
  part: number;
  parts: number;
  /** frames finished over all parts */
  frame: number;
  frames: number;
}

export interface ExportedPart {
  name: string;
  blob: Blob;
  seconds: number;
}

export interface ExportResult {
  parts: ExportedPart[];
  warnings: string[];
}

interface Src {
  input: Input | null;
  sink: CanvasSink | null;
  /** set for a still picture: the same picture is drawn on every frame */
  image: ImageBitmap | null;
  at: InputAudioTrack | null;
}

const abortError = () => new DOMException('Export cancelled', 'AbortError');

/** Reads decoded frames of one clip in order, so each frame is decoded once. */
class FrameReader {
  private iter: AsyncGenerator<WrappedCanvas, void, unknown>;
  private cur: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;

  constructor(sink: CanvasSink, from: number, to: number) {
    this.iter = sink.canvases(from, to);
  }

  /** The frame that is on screen at source time `t` (frames only move forward). */
  async at(t: number): Promise<WrappedCanvas | null> {
    for (;;) {
      if (!this.next && !this.done) {
        const r = await this.iter.next();
        if (r.done) this.done = true;
        else this.next = r.value;
      }
      if (this.next && this.next.timestamp <= t + 1e-4) {
        this.cur = this.next;
        this.next = null;
        continue;
      }
      if (!this.cur && this.next) {
        this.cur = this.next; // asked for a moment before the first frame: show the first one
        this.next = null;
      }
      return this.cur;
    }
  }

  async close(): Promise<void> {
    this.cur = this.next = null;
    await this.iter.return(undefined).catch(() => {});
  }
}

interface AudioPlan {
  codec: 'aac' | 'opus';
  sampleRate: number;
  bitrate: number;
}

async function pickAudioPlan(): Promise<AudioPlan | null> {
  const tries: AudioPlan[] = [
    { codec: 'aac', sampleRate: 48000, bitrate: 128_000 },
    { codec: 'aac', sampleRate: 44100, bitrate: 128_000 },
    { codec: 'opus', sampleRate: 48000, bitrate: 128_000 },
  ];
  for (const t of tries) {
    try {
      if (await canEncodeAudio(t.codec, { numberOfChannels: 2, sampleRate: t.sampleRate, quality: new Quality({ bitrate: t.bitrate }) })) return t;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/** Decodes the part of the soundtrack that falls inside `part`, speeds it up/down, and mixes it. */
async function renderPartAudio(
  srcs: Map<string, Src>,
  clips: Clip[],
  part: Part,
  fps: number,
  sampleRate: number,
  signal: AbortSignal,
): Promise<AudioBuffer> {
  const seconds = (part.endFrame - part.startFrame) / fps;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round(seconds * sampleRate)), sampleRate);
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const s = srcs.get(clip.mediaId);
    if (!s?.at || clip.volume <= 0) continue;
    const outStart = Math.max(part.start, clip.at);
    const outEnd = Math.min(part.end, clip.at + clipDuration(clip));
    if (outEnd - outStart < 1e-3) continue;
    const srcStart = sourceTimeAt(clip, outStart - clip.at);
    const srcEnd = Math.min(clip.end, sourceTimeAt(clip, outEnd - clip.at));

    const rate = await s.at.getSampleRate();
    const chCount = Math.max(1, Math.min(2, await s.at.getNumberOfChannels()));
    const len = Math.max(1, Math.round((srcEnd - srcStart) * rate));
    const chans = Array.from({ length: chCount }, () => new Float32Array(len));
    for await (const { buffer, timestamp } of new AudioBufferSink(s.at).buffers(srcStart, srcEnd)) {
      if (signal.aborted) throw abortError();
      const off = Math.round((timestamp - srcStart) * rate);
      for (let c = 0; c < chCount; c++) {
        const data = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const from = Math.max(0, -off);
        const to = Math.max(0, off);
        const n = Math.min(data.length - from, len - to);
        if (n > 0) chans[c]!.set(data.subarray(from, from + n), to);
      }
    }
    const stretched = clip.keepPitch ? timeStretch(chans, rate, clip.speed) : resample(chans, clip.speed);
    if (clip.volume < 1) for (const ch of stretched) for (let i = 0; i < ch.length; i++) ch[i]! *= clip.volume;
    const ab = new AudioBuffer({ length: stretched[0]!.length, numberOfChannels: chCount, sampleRate: rate });
    stretched.forEach((data, c) => ab.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    const node = ctx.createBufferSource();
    node.buffer = ab;
    node.connect(ctx.destination);
    node.start(Math.max(0, outStart - part.start));
  }
  return ctx.startRendering();
}

const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'video';

/**
 * Renders the project into one or more MP4 files, entirely on this device.
 * Parts are rendered one after another; only one part is held in memory while it is encoded.
 */
export async function exportProject(
  project: Project,
  getBlob: (mediaId: string) => Blob | undefined,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  if (typeof VideoEncoder === 'undefined') {
    throw new FriendlyError("This browser can't save videos. Please update it, or use a recent Chrome, Edge or Safari.");
  }
  const { clips, settings } = project;
  if (clips.length === 0) throw new FriendlyError('Add a video first.');
  const { fps } = settings;
  const total = totalOf(clips);
  const parts = planParts(total, settings.splitSeconds, settings.equalParts, fps);
  if (parts.length === 0) throw new FriendlyError('Nothing to export: the clips are empty.');
  const { w: outW, h: outH } = outputSize(project);
  const bitrate = videoBitrate(settings, outW, outH);
  const warnings: string[] = [];

  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: outW, height: outH, frameRate: fps, quality: new Quality({ bitrate }) });
  if (!codec) {
    throw new FriendlyError(
      settings.bitrateMbps != null
        ? `This device can't encode video at ${outW}×${outH} with a ${(bitrate / 1e6).toFixed(1)} Mbps target. Try a lower bitrate, a lower resolution or 30 fps.`
        : `This device can't encode video at ${outW}×${outH}. Try a lower resolution or 30 fps.`,
    );
  }
  if (codec !== 'avc') warnings.push("This device can't make H.264 video, so the files use VP9. Some apps may not accept them.");

  const wantsAudio = clips.some((c) => c.volume > 0 && project.media[c.mediaId]?.hasAudio);
  let plan: AudioPlan | null = null;
  if (wantsAudio) {
    plan = typeof AudioEncoder === 'undefined' ? null : await pickAudioPlan();
    if (!plan) warnings.push("This browser can't encode sound, so the exported files have no audio.");
    else if (plan.codec !== 'aac') warnings.push("This device can't make AAC sound, so the files use Opus audio. Some apps (for example Instagram or iPhone Photos) may not play the sound.");
  }

  const srcs = new Map<string, Src>();
  const wake = await awakeForJob().catch(() => null);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new FriendlyError('Could not create a drawing surface.');

  const totalFrames = parts.reduce((n, p) => n + (p.endFrame - p.startFrame), 0);
  let framesDone = 0;
  let lastReport = 0;
  const results: ExportedPart[] = [];
  const base = safeName(project.name);

  try {
    for (const id of new Set(clips.map((c) => c.mediaId))) {
      const blob = getBlob(id);
      if (!blob) throw new FriendlyError('A video file is missing. Remove that clip and add it again.');
      if (project.media[id]?.kind === 'image') {
        const image = mediaBitmap(id);
        if (!image) throw new FriendlyError('A picture is missing. Remove that clip and add it again.');
        srcs.set(id, { input: null, sink: null, image, at: null });
        continue;
      }
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      if (project.media[id]?.kind === 'audio') {
        const at = plan ? await input.getPrimaryAudioTrack() : null;
        srcs.set(id, { input, sink: null, image: null, at: at && (await at.canDecode()) ? at : null });
        continue;
      }
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new FriendlyError('A video file has no picture in it.');
      const w = await vt.getDisplayWidth();
      const h = await vt.getDisplayHeight();
      const scale = Math.min(1, 3840 / Math.max(w, h)); // decode at most 4K
      const sink = new CanvasSink(vt, scale < 1 ? { width: Math.round(w * scale), height: Math.round(h * scale), fit: 'fill' } : {});
      const at = plan ? await input.getPrimaryAudioTrack() : null;
      srcs.set(id, { input, sink, image: null, at: at && (await at.canDecode()) ? at : null });
    }

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      const frames = part.endFrame - part.startFrame;
      const target = new BufferTarget();
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
      const vs = new CanvasSource(canvas, { codec, quality: new Quality({ bitrate }), keyFrameInterval: 2 });
      output.addVideoTrack(vs, { frameRate: fps });
      let as: AudioBufferSource | null = null;
      if (plan) {
        as = new AudioBufferSource({ codec: plan.codec, quality: new Quality({ bitrate: plan.bitrate }) });
        output.addAudioTrack(as);
      }
      const readers = new Map<string, FrameReader>();
      const closeReaders = async () => {
        for (const r of readers.values()) await r.close();
        readers.clear();
      };
      try {
        await output.start();
        for (let j = 0; j < frames; j++) {
          if (signal.aborted) throw abortError();
          const t = (part.startFrame + j) / fps;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, outW, outH);
          const playing = activeAt(clips, t);
          // a reader whose clip is no longer on screen is done
          for (const [id, r] of readers) {
            if (!playing.some((i) => clips[i]!.id === id)) {
              await r.close();
              readers.delete(id);
            }
          }
          for (const i of playing) {
            const clip = clips[i]!;
            const src = srcs.get(clip.mediaId)!;
            if (project.media[clip.mediaId]?.kind === 'audio') continue;
            const o = { outW, outH, view: clip.view, keepBackground: true };
            if (src.image) {
              drawFrame(ctx, src.image, src.image.width, src.image.height, o);
              continue;
            }
            const srcT = sourceAt(clip, t);
            let r = readers.get(clip.id);
            if (!r) {
              r = new FrameReader(src.sink!, srcT, clip.end + 0.05);
              readers.set(clip.id, r);
            }
            const f = await r.at(srcT);
            if (f) drawFrame(ctx, f.canvas, f.canvas.width, f.canvas.height, o);
          }
          await vs.add(j / fps, 1 / fps);
          framesDone++;
          const now = performance.now();
          if (now - lastReport > 150) {
            lastReport = now;
            onProgress({ part: pi + 1, parts: parts.length, frame: framesDone, frames: totalFrames });
            await new Promise((r) => setTimeout(r, 0)); // let the screen update
          }
        }
        await closeReaders();
        vs.close();
        if (as && plan) {
          const mix = await renderPartAudio(srcs, clips, part, fps, plan.sampleRate, signal);
          await as.add(mix);
          as.close();
        }
        await output.finalize();
      } catch (e) {
        await closeReaders();
        await output.cancel().catch(() => {});
        throw e;
      }
      const buf = target.buffer;
      if (!buf) throw new FriendlyError('Saving produced no data.');
      results.push({
        name: parts.length === 1 ? `${base}.mp4` : `${base}_${pi + 1}of${parts.length}.mp4`,
        blob: new Blob([buf], { type: 'video/mp4' }),
        seconds: frames / fps,
      });
      onProgress({ part: pi + 1, parts: parts.length, frame: framesDone, frames: totalFrames });
    }
  } finally {
    for (const s of srcs.values()) s.input?.dispose();
    await wake?.release().catch(() => {});
  }
  return { parts: results, warnings };
}
