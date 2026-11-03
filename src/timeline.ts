import type { Clip } from './types.ts';

export const MIN_CLIP = 0.1;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** How long a clip plays on the timeline (trim length divided by speed). */
export function clipDuration(c: Clip): number {
  return Math.max(0, (c.end - c.start) / c.speed);
}

export const clipEnd = (c: Clip): number => c.at + clipDuration(c);

/** Length of the whole timeline: the end of the last clip. */
export function totalOf(clips: Clip[]): number {
  let t = 0;
  for (const c of clips) t = Math.max(t, clipEnd(c));
  return t;
}

/** Where the next clip added to `track` goes: right after the last clip on it. */
export function endOfTrack(clips: Clip[], track: number): number {
  let t = 0;
  for (const c of clips) if (c.track === track) t = Math.max(t, clipEnd(c));
  return t;
}

/** Indices of the clips that play at timeline time t, lowest lane first (drawing order). */
export function activeAt(clips: Clip[], t: number): number[] {
  const out: number[] = [];
  clips.forEach((c, i) => {
    if (t >= c.at - 1e-9 && t < clipEnd(c) - 1e-9) out.push(i);
  });
  return out.sort((a, b) => clips[a]!.track - clips[b]!.track || a - b);
}

/** The picture of a clip at timeline time t (seconds in its source file), kept inside the trim. */
export function sourceAt(c: Clip, t: number): number {
  return Math.min(c.start + Math.max(0, t - c.at) * c.speed, Math.max(c.start, c.end - 1e-3));
}

/** source time for a time `local` seconds into the clip */
export const sourceTimeAt = (c: Clip, local: number) => c.start + local * c.speed;

export interface Part {
  /** timeline seconds */
  start: number;
  end: number;
  /** whole output frames the part contains */
  startFrame: number;
  endFrame: number;
}

/**
 * Cuts the timeline into output files. With `equal`, every part gets the same length (all within
 * `limit`); otherwise parts are `limit` long and the last one holds the remainder.
 */
export function planParts(total: number, limit: number | null, equal: boolean, fps: number): Part[] {
  if (total <= 0) return [];
  const bounds: number[] = [0];
  if (limit && total > limit + 1e-6) {
    if (equal) {
      const n = Math.ceil(total / limit - 1e-9);
      for (let i = 1; i < n; i++) bounds.push((total * i) / n);
    } else {
      for (let t = limit; t < total - 1e-6; t += limit) bounds.push(t);
    }
  }
  bounds.push(total);
  const parts: Part[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startFrame = Math.round(bounds[i]! * fps);
    const endFrame = i === bounds.length - 2 ? Math.max(startFrame, Math.round(total * fps)) : Math.round(bounds[i + 1]! * fps);
    if (endFrame - startFrame < 1) continue; // a sliver shorter than one frame is not a file
    parts.push({ start: startFrame / fps, end: endFrame / fps, startFrame, endFrame });
  }
  return parts;
}

export function fmtTime(s: number, decimals = 1): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const secStr = sec.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return `${m}:${secStr}`;
}
