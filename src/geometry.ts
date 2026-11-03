import type { AspectChoice, Project, View } from './types.ts';

export const IDENTITY_VIEW: View = { x: 0, y: 0, zoom: 1, rot: 0 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 12;

export const ASPECT_VALUE: Record<AspectChoice, number> = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 };

const RAD = Math.PI / 180;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Scale (canvas pixels per source pixel) at which the whole unrotated picture just fits the canvas. zoom 1 means this. */
export const baseScale = (sw: number, sh: number, outW: number, outH: number): number => Math.min(outW / sw, outH / sh);

export interface DrawOptions {
  outW: number;
  outH: number;
  view: View;
}

export interface FrameTransform {
  /** where the center of the source picture lands on the output canvas */
  tx: number;
  ty: number;
  /** radians, clockwise */
  angle: number;
  /** canvas pixels per source pixel */
  scale: number;
}

/**
 * Pure maths for placing a source picture (sw x sh) on an output canvas. `view.x/y` move the picture's
 * center away from the canvas center in canvas widths/heights, `view.zoom` 1 is "whole picture fits",
 * `view.rot` is degrees clockwise. Preview and export both use this, so what you see is what you get.
 */
export function frameTransform(sw: number, sh: number, o: DrawOptions): FrameTransform {
  return {
    tx: o.outW / 2 + o.view.x * o.outW,
    ty: o.outH / 2 + o.view.y * o.outH,
    angle: o.view.rot * RAD,
    scale: baseScale(sw, sh, o.outW, o.outH) * o.view.zoom,
  };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function drawFrame(ctx: Ctx2D, src: CanvasImageSource, sw: number, sh: number, o: DrawOptions): void {
  const t = frameTransform(sw, sh, o);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, o.outW, o.outH);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(t.tx, t.ty);
  ctx.rotate(t.angle);
  ctx.scale(t.scale, t.scale);
  ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

/** Normalizes degrees to (-180, 180]. */
export function normAngle(d: number): number {
  let a = ((d % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

/** Size of the box that holds the picture turned by `rot` degrees. */
export function turnedBox(sw: number, sh: number, rot: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(rot * RAD));
  const s = Math.abs(Math.sin(rot * RAD));
  return { w: sw * c + sh * s, h: sw * s + sh * c };
}

/** zoom at which the turned picture just fits inside the canvas (bars if the shapes differ). */
export function fitZoom(sw: number, sh: number, rot: number, outW: number, outH: number): number {
  const b = turnedBox(sw, sh, rot);
  return Math.min(outW / b.w, outH / b.h) / baseScale(sw, sh, outW, outH);
}

/** zoom at which the turned picture just covers the whole canvas (edges trimmed if the shapes differ). */
export function fillZoom(sw: number, sh: number, rot: number, outW: number, outH: number): number {
  const b = turnedBox(sw, sh, rot);
  return Math.max(outW / b.w, outH / b.h) / baseScale(sw, sh, outW, outH);
}

export interface Pt {
  x: number;
  y: number;
}

/** One finger: the picture follows it. `dx/dy` in canvas units (same units as W, H). */
export function dragView(v: View, W: number, H: number, dx: number, dy: number): View {
  return { ...v, x: v.x + dx / W, y: v.y + dy / H };
}

/**
 * Two fingers: pinch to zoom, twist to turn, move to pan, all about the point between the fingers.
 * Points are relative to the canvas center, in canvas units.
 */
export function pinchView(v: View, W: number, H: number, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const v0 = { x: b0.x - a0.x, y: b0.y - a0.y };
  const v1 = { x: b1.x - a1.x, y: b1.y - a1.y };
  const l0 = Math.hypot(v0.x, v0.y) || 1;
  const l1 = Math.hypot(v1.x, v1.y) || 1;
  const s = l1 / l0;
  const d = Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const c0 = { x: v.x * W - m0.x, y: v.y * H - m0.y };
  const cos = Math.cos(d);
  const sin = Math.sin(d);
  const cx = m1.x + s * (c0.x * cos - c0.y * sin);
  const cy = m1.y + s * (c0.x * sin + c0.y * cos);
  return { x: cx / W, y: cy / H, zoom: clampZoom(v.zoom * s), rot: v.rot + d / RAD };
}

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export interface Snap {
  view: View;
  /** what the view snapped to, for the guides on screen */
  x: boolean;
  y: boolean;
  rot: number | null;
  zoom: 'fit' | 'fill' | null;
}

export interface SnapEnv {
  sw: number;
  sh: number;
  W: number;
  H: number;
  /** px (canvas units) within which the center snaps */
  centerPx?: number;
  /** degrees within which rotation snaps to a multiple of 90 */
  rotDeg?: number;
  /** relative distance within which zoom snaps to fit or fill */
  zoomRel?: number;
}

/** Magnets for the free transform: center on both axes, quarter turns, whole picture fits, picture fills. */
export function snapView(raw: View, e: SnapEnv): Snap {
  let { x, y, zoom, rot } = raw;
  rot = normAngle(rot);
  const out: Snap = { view: raw, x: false, y: false, rot: null, zoom: null };
  const q = Math.round(rot / 90) * 90;
  if (Math.abs(rot - q) <= (e.rotDeg ?? 4)) {
    rot = q === 180 ? 180 : q === -180 ? 180 : q;
    out.rot = normAngle(q);
  }
  const fit = fitZoom(e.sw, e.sh, rot, e.W, e.H);
  const fill = fillZoom(e.sw, e.sh, rot, e.W, e.H);
  const near = (z: number) => Math.abs(zoom - z) / z <= (e.zoomRel ?? 0.035);
  // when fit and fill are almost the same, the shapes match: call it fit
  if (near(fit)) (zoom = fit), (out.zoom = 'fit');
  else if (Math.abs(fill - fit) / fit > 0.02 && near(fill)) (zoom = fill), (out.zoom = 'fill');
  const cp = e.centerPx ?? 7;
  if (Math.abs(x * e.W) <= cp) (x = 0), (out.x = true);
  if (Math.abs(y * e.H) <= cp) (y = 0), (out.y = true);
  out.view = { x, y, zoom, rot };
  return out;
}

/** Keeps the picture's center on the canvas, so it can never be dragged out of reach. */
export function clampView(v: View): View {
  return { ...v, x: Math.min(0.5, Math.max(-0.5, v.x)), y: Math.min(0.5, Math.max(-0.5, v.y)), zoom: clampZoom(v.zoom) };
}

/** Picture size after the nearest quarter turn: decides the shape of the "Auto" canvas. */
export function quarterTurned(w: number, h: number, rot: number): { w: number; h: number } {
  const q = ((Math.round(rot / 90) % 4) + 4) % 4;
  return q % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** The canvas shape that suits a picture best (closest in ratio). Used when a project starts. */
export function nearestAspect(w: number, h: number): AspectChoice {
  const r = Math.log(w / h);
  let best: AspectChoice = '9:16';
  let d = Infinity;
  for (const k of Object.keys(ASPECT_VALUE) as AspectChoice[]) {
    const dd = Math.abs(Math.log(ASPECT_VALUE[k]) - r);
    if (dd < d) (d = dd), (best = k);
  }
  return best;
}

/** Output size in pixels for a project. */
export function outputSize(p: Project): { w: number; h: number } {
  const aspect = ASPECT_VALUE[p.settings.aspect] ?? 9 / 16;
  const short = p.settings.resolution;
  return aspect <= 1 ? { w: even(short), h: even(short / aspect) } : { w: even(short * aspect), h: even(short) };
}
