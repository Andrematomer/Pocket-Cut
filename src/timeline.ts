import type { Clip } from './types.ts';

export const MIN_CLIP = 0.1;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

/** How long a clip plays on the timeline (trim length divided by speed). */
export function clipDuration(c: Clip): number {
  return Math.max(0, (c.end - c.start) / c.speed);
}

export interface Layout {
  starts: number[];
  durations: number[];
  total: number;
}

export function layout(clips: Clip[]): Layout {
  const starts: number[] = [];
  const durations: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(t);
    const d = clipDuration(c);
    durations.push(d);
    t += d;
  }
  return { starts, durations, total: t };
}

/** Which clip plays at timeline time t, and how far into it (in timeline seconds). */
export function locate(l: Layout, t: number): { index: number; local: number } | null {
  if (l.starts.length === 0) return null;
  const tt = Math.max(0, Math.min(t, l.total));
  for (let i = l.starts.length - 1; i >= 0; i--) {
    if (tt >= l.starts[i]! - 1e-9) {
      const local = Math.min(tt - l.starts[i]!, l.durations[i]!);
      return { index: i, local };
    }
  }
  return { index: 0, local: 0 };
}

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
