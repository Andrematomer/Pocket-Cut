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

/** An empty stretch on one lane, between the end of a clip (or 0) and the start of the next one. */
export interface Gap {
  track: number;
  from: number;
  to: number;
  /** the whole lane is picked (it is empty and lies between used lanes) */
  lane?: boolean;
}

const MIN_GAP = 0.05;

/** The gap on `track` that covers timeline time t, or null when t is on a clip or after the last clip. */
export function gapAt(clips: Clip[], track: number, t: number): Gap | null {
  let from = 0;
  let to = Infinity;
  for (const c of clips) {
    if (c.track !== track) continue;
    const e = clipEnd(c);
    if (t >= c.at - 1e-9 && t < e - 1e-9) return null;
    if (e <= t + 1e-9) from = Math.max(from, e);
    else to = Math.min(to, c.at);
  }
  if (!isFinite(to) || to - from < MIN_GAP) return null;
  return { track, from, to };
}

/**
 * Closes a gap: every clip that starts at or after its end moves earlier by the gap's length, on all
 * lanes. A moved clip that would land on another clip of its lane goes to the next lane out (see
 * resolveOverlaps).
 */
export function removeGap(clips: Clip[], gap: Gap): Clip[] {
  const len = gap.to - gap.from;
  const eps = 1e-6;
  const out = clips.map((c) => ({ ...c }));
  const moving = out.filter((c) => c.at >= gap.to - eps);
  const still = out.filter((c) => c.at < gap.to - eps);
  moving.sort((a, b) => Math.abs(a.track) - Math.abs(b.track) || a.at - b.at);
  const placed: Clip[] = [...still];
  for (const c of moving) c.at = Math.max(0, Math.round((c.at - len) * 100) / 100);
  // pass 1: clips that fit on their own lane stay there, so a hop never takes a lane a later clip needs
  const hop: Clip[] = [];
  for (const c of moving) {
    const clash = still.some((o) => o.track === c.track && c.at < clipEnd(o) - eps && o.at < clipEnd(c) - eps);
    if (clash) hop.push(c);
    else placed.push(c);
  }
  // pass 2: a clashing clip goes to the next lane out, and whatever it lands on is pushed out the same way
  let res = out;
  for (const c of hop) res = resolveOverlaps(res, [c.id]);
  return res;
}

/**
 * Keeps every lane free of overlaps without ever reshuffling the order of the picture: a clip in `ids`
 * that overlaps another one on its lane goes to the NEXT lane out (up from lane 0, down below it), not
 * to the next lane that happens to be free. If it lands on something there, that clip is pushed to the
 * next lane out in turn, and so on.
 */
export function resolveOverlaps(clips: Clip[], ids: string[]): Clip[] {
  const out = clips.map((c) => ({ ...c }));
  const eps = 1e-6;
  const hit = (a: Clip, b: Clip) => a.id !== b.id && a.track === b.track && a.at < clipEnd(b) - eps && b.at < clipEnd(a) - eps;
  const out1 = (c: Clip) => (c.track += c.track >= 0 ? 1 : -1);
  const shove = (c: Clip, depth: number) => {
    if (depth > 400) return;
    for (const o of out) {
      if (hit(c, o)) {
        out1(o);
        shove(o, depth + 1);
      }
    }
  };
  for (const id of ids) {
    const c = out.find((x) => x.id === id);
    if (!c) continue;
    if (out.some((o) => hit(c, o))) {
      out1(c);
      shove(c, 0);
    }
  }
  return out;
}

/**
 * The track a clip can sit on at its place: the wanted one if nothing is there, otherwise the next one
 * further out (up from 0, down below 0). `others` must not contain the clip itself.
 */
export function freeTrack(others: Clip[], at: number, dur: number, track: number): number {
  const dir = track >= 0 ? 1 : -1;
  const busy = (t: number) => others.some((o) => o.track === t && at < clipEnd(o) - 1e-6 && o.at < at + dur - 1e-6);
  let t = track;
  for (let i = 0; i < 200 && busy(t); i++) t += dir;
  return t;
}

/**
 * A strip dropped within a hair of a neighbour's edge (the finger lands between two frames, or the
 * rounding to hundredths leaves a sliver) sits flush against it instead of overlapping by a sliver.
 * Returns the exact start, or null when nothing is that close.
 */
export function settleAt(others: Clip[], at: number, dur: number, track: number): number | null {
  const near = 0.012;
  let best: number | null = null;
  let d = near;
  for (const o of others) {
    if (o.track !== track) continue;
    for (const cand of [clipEnd(o), o.at - dur]) {
      const dd = Math.abs(at - cand);
      if (dd <= d && cand >= 0) (d = dd), (best = cand);
    }
  }
  return best;
}

/**
 * An empty lane that lies between used ones can be removed: it is empty, and there are strips on lanes on both
 * sides of it. Returns false for any other lane.
 */
export function laneRemovable(clips: Clip[], track: number): boolean {
  if (clips.some((c) => c.track === track)) return false;
  return clips.some((c) => c.track > track) && clips.some((c) => c.track < track);
}

/**
 * Takes an empty lane out of the stack. The strips on the far side of it (further from lane 0) move one lane
 * toward 0; for lane 0 itself, the side that reaches further out is the one that moves.
 */
export function removeLane(clips: Clip[], track: number): Clip[] {
  if (!laneRemovable(clips, track)) return clips;
  let up: boolean;
  if (track > 0) up = true;
  else if (track < 0) up = false;
  else up = Math.max(...clips.map((c) => c.track)) >= -Math.min(...clips.map((c) => c.track));
  return clips.map((c) => (up ? (c.track > track ? { ...c, track: c.track - 1 } : c) : c.track < track ? { ...c, track: c.track + 1 } : c));
}

/**
 * Uses as few lanes as possible without changing what is drawn over what. Two strips that overlap in time keep their
 * order (the one that was higher stays higher); strips that never overlap may share a lane. Each strip goes to the
 * lowest lane its overlapping lower neighbours allow, which is the fewest lanes there can be. The whole stack is
 * then shifted to sit as near its old place as it can. Returns the new strips and how many changed lane.
 */
export function optimizeLanes(clips: Clip[]): { clips: Clip[]; moved: number } {
  if (clips.length === 0) return { clips, moved: 0 };
  const hit = (a: Clip, b: Clip) => a.at < clipEnd(b) - 1e-6 && b.at < clipEnd(a) - 1e-6;
  const order = [...clips].sort((a, b) => a.track - b.track || a.at - b.at);
  const depth = new Map<string, number>();
  order.forEach((c, i) => {
    let d = 0;
    for (let j = 0; j < i; j++) {
      const o = order[j]!;
      if (o.track < c.track && hit(c, o)) d = Math.max(d, depth.get(o.id)! + 1);
    }
    depth.set(c.id, d);
  });
  // shift: the median of (old lane - new depth), so most strips stay where they were
  const offs = clips.map((c) => c.track - depth.get(c.id)!).sort((a, b) => a - b);
  const shift = offs[Math.floor(offs.length / 2)]!;
  let moved = 0;
  const out = clips.map((c) => {
    const track = depth.get(c.id)! + shift;
    if (track !== c.track) moved++;
    return track === c.track ? c : { ...c, track };
  });
  return { clips: out, moved };
}
