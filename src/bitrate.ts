import type { ExportSettings } from './types.ts';

/** Target video bitrate limits (megabits per second) that the editor accepts. */
export const MIN_MBPS = 0.3;
export const MAX_MBPS = 50;
export const AUDIO_BPS = 128_000;

/** Bits per pixel per frame for the three quality presets (used when no target bitrate is set). */
const BITS_PER_PIXEL = { small: 0.05, medium: 0.08, high: 0.12 } as const;

export const clampMbps = (m: number): number => Math.min(MAX_MBPS, Math.max(MIN_MBPS, m));

/** The bitrate (bits per second) the quality preset gives for this picture size. */
export function autoBitrate(w: number, h: number, fps: number, quality: ExportSettings['quality']): number {
  return Math.max(800_000, Math.round(w * h * fps * BITS_PER_PIXEL[quality]));
}

/** The video bitrate in bits per second the export will ask the encoder for. */
export function videoBitrate(s: Pick<ExportSettings, 'bitrateMbps' | 'quality' | 'fps'>, w: number, h: number): number {
  if (s.bitrateMbps != null && Number.isFinite(s.bitrateMbps)) return Math.round(clampMbps(s.bitrateMbps) * 1_000_000);
  return autoBitrate(w, h, s.fps, s.quality);
}

/** Rough size of an exported part. Real files vary a little with the picture. */
export function estimateBytes(videoBps: number, seconds: number, withAudio: boolean): number {
  return Math.round(((videoBps + (withAudio ? AUDIO_BPS : 0)) * seconds) / 8);
}

export const fmtMbps = (bps: number): string => {
  const m = bps / 1_000_000;
  return `${m >= 10 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, '')} Mbps`;
};
