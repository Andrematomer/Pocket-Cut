import type { AspectChoice, Crop, Project, View } from './types.ts';

export const IDENTITY_VIEW: View = { x: 0, y: 0, zoom: 1, rot: 0 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 12;

export const ASPECT_VALUE: Record<AspectChoice, number> = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '5:4': 5 / 4, '16:9': 16 / 9 };

const RAD = Math.PI / 180;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Scale (canvas pixels per source pixel) at which the whole unrotated picture just fits the canvas. zoom 1 means this. */
export const baseScale = (sw: number, sh: number, outW: number, outH: number): number => Math.min(outW / sw, outH / sh);

export interface DrawOptions {
  outW: number;
  outH: number;
  view: View;
  /** false: draw on top of what is already there (layers) instead of starting from black */
  keepBackground?: boolean;
  /** color to start from when keepBackground is false (default black) */
  background?: string;
  /** 0..1, how opaque the picture is drawn */
  alpha?: number;
  /** sides cut off the picture (fractions of its size) */
  crop?: Crop;
  /** real pixel size of `src` when it differs from sw x sh (a shrunk copy) */
  srcW?: number;
  srcH?: number;
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
  if (!o.keepBackground) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = o.background ?? '#000';
    ctx.fillRect(0, 0, o.outW, o.outH);
  }
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(t.tx, t.ty);
  ctx.rotate(t.angle);
  ctx.scale(t.scale, t.scale);
  const c = o.crop;
  if (c && (c.l !== 0 || c.t !== 0 || c.r !== 0 || c.b !== 0)) {
    const pw = o.srcW ?? sw;
    const ph = o.srcH ?? sh;
    // a crop cuts a side off; a negative one (flat colors only) pushes the side outwards, stretching the picture
    const k = (v: number) => Math.min(0.98, Math.max(-3, v));
    let l = k(c.l);
    let t = k(c.t);
    let r = k(c.r);
    let b = k(c.b);
    if (1 - l - r < 0.02) r = 0.98 - l;
    if (1 - t - b < 0.02) b = 0.98 - t;
    const sl = Math.max(0, l);
    const st = Math.max(0, t);
    const sr = Math.max(0, r);
    const sb = Math.max(0, b);
    ctx.drawImage(src, sl * pw, st * ph, (1 - sl - sr) * pw, (1 - st - sb) * ph, -sw / 2 + l * sw, -sh / 2 + t * sh, (1 - l - r) * sw, (1 - t - b) * sh);
  } else {
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
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
  /** a side of the picture sits exactly on a side of the frame */
  edge: boolean;
  /** which sides of the frame the picture's sides sit on */
  edges: { l: boolean; r: boolean; t: boolean; b: boolean };
}

export interface SnapEnv {
  sw: number;
  sh: number;
  W: number;
  H: number;
  /** px (canvas units) within which the center snaps */
  centerPx?: number;
  /** degrees within which rotation snaps to a multiple of 45 */
  rotDeg?: number;
  /** relative distance within which zoom snaps to fit or fill */
  zoomRel?: number;
}

/** Magnets for the free transform: center on both axes, quarter turns, whole picture fits, picture fills. */
export function snapView(raw: View, e: SnapEnv): Snap {
  let { x, y, zoom, rot } = raw;
  rot = normAngle(rot);
  const out: Snap = { view: raw, x: false, y: false, rot: null, zoom: null, edge: false, edges: { l: false, r: false, t: false, b: false } };
  const q = Math.round(rot / 45) * 45;
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
  // sides of the picture onto the sides of the frame (when the middle did not already catch)
  const bz = turnedBox(e.sw, e.sh, rot);
  const sc = baseScale(e.sw, e.sh, e.W, e.H) * zoom;
  const hw = (bz.w * sc) / 2;
  const hh = (bz.h * sc) / 2;
  if (!out.x) {
    if (Math.abs(x * e.W - hw + e.W / 2) <= cp) (x = (hw - e.W / 2) / e.W), (out.edge = true), (out.edges.l = true);
    else if (Math.abs(x * e.W + hw - e.W / 2) <= cp) (x = (e.W / 2 - hw) / e.W), (out.edge = true), (out.edges.r = true);
  }
  if (!out.y) {
    if (Math.abs(y * e.H - hh + e.H / 2) <= cp) (y = (hh - e.H / 2) / e.H), (out.edge = true), (out.edges.t = true);
    else if (Math.abs(y * e.H + hh - e.H / 2) <= cp) (y = (e.H / 2 - hh) / e.H), (out.edge = true), (out.edges.b = true);
  }
  out.view = { x, y, zoom, rot };
  return out;
}

/** How much of the picture (share of its box, per axis) must stay inside the frame: 10% = up to 90% can be out. */
export const MIN_VISIBLE = 0.1;

/**
 * Keeps at least a sliver of the picture inside the frame, so it can never be dragged out of reach.
 * With `env` the limit follows the picture (up to 90% of it may leave); without, the center stays on the canvas.
 */
export function clampView(v: View, env?: { sw: number; sh: number; W: number; H: number }): View {
  const zoom = clampZoom(v.zoom);
  let mx = 0.5;
  let my = 0.5;
  if (env) {
    const b = turnedBox(env.sw, env.sh, v.rot);
    const sc = baseScale(env.sw, env.sh, env.W, env.H) * zoom;
    const hw = (b.w * sc) / 2;
    const hh = (b.h * sc) / 2;
    mx = (env.W / 2 + hw * (1 - 2 * MIN_VISIBLE)) / env.W;
    my = (env.H / 2 + hh * (1 - 2 * MIN_VISIBLE)) / env.H;
  }
  return { ...v, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)), zoom };
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

/**
 * Double-tap snap: of the eight "tidy" placements (quarter turns 0/90/180/270, each either fitting
 * the whole picture or filling the frame, centered) the one closest to the current view. Tapping again
 * on a tidy placement switches between fit and fill.
 */
export function snapEight(v: View, sw: number, sh: number, W: number, H: number): View {
  let best: View | null = null;
  let cost = Infinity;
  const options: { view: View; cost: number; fit: boolean; rot: number }[] = [];
  for (let q = 0; q < 4; q++) {
    const rot = q * 90;
    const dAng = Math.abs(normAngle(v.rot - rot)) / 90;
    const fit = fitZoom(sw, sh, rot, W, H);
    const fill = fillZoom(sw, sh, rot, W, H);
    const targets: [number, boolean][] = Math.abs(fill - fit) / fit > 0.02 ? [[fit, true], [fill, false]] : [[fit, true]];
    for (const [z, isFit] of targets) {
      const c = dAng + Math.abs(Math.log(v.zoom / z)) + Math.hypot(v.x, v.y) * 0.5;
      options.push({ view: { x: 0, y: 0, zoom: z, rot }, cost: c, fit: isFit, rot });
      if (c < cost) (cost = c), (best = options[options.length - 1]!.view);
    }
  }
  const pick = options.find((o) => o.view === best)!;
  // already there: flip to the other zoom of the same turn
  if (pick.cost < 0.03) {
    const other = options.find((o) => o.rot === pick.rot && o.fit !== pick.fit);
    if (other) return other.view;
  }
  return pick.view;
}

/**
 * Double-tap snap for a cropped picture: fits or fills the part that is left after the crop, and centers
 * that part (not the whole picture) on the canvas.
 */
export function snapEightCropped(v: View, crop: Crop | undefined, sw: number, sh: number, W: number, H: number): View {
  const l = crop?.l ?? 0;
  const t = crop?.t ?? 0;
  const r = crop?.r ?? 0;
  const b = crop?.b ?? 0;
  if (!l && !t && !r && !b) return snapEight(v, sw, sh, W, H);
  const cw = sw * (1 - l - r);
  const ch = sh * (1 - t - b);
  const k = baseScale(cw, ch, W, H) / baseScale(sw, sh, W, H); // zoom of the picture = zoom of the cropped part * k
  // where the middle of the kept part sits, in canvas units, relative to the picture's middle
  const shift = (zoom: number, rot: number) => {
    const sc = baseScale(sw, sh, W, H) * zoom;
    const lx = ((l - r) / 2) * sw * sc;
    const ly = ((t - b) / 2) * sh * sc;
    const a = rot * RAD;
    return { x: lx * Math.cos(a) - ly * Math.sin(a), y: lx * Math.sin(a) + ly * Math.cos(a) };
  };
  const o = shift(v.zoom, v.rot);
  const cur: View = { x: v.x + o.x / W, y: v.y + o.y / H, zoom: v.zoom / k, rot: v.rot };
  const s = snapEight(cur, cw, ch, W, H);
  const zoom = s.zoom * k;
  const o2 = shift(zoom, s.rot);
  return { x: s.x - o2.x / W, y: s.y - o2.y / H, zoom, rot: s.rot };
}


/**
 * snapView for a picture with margins (a crop, or the empty space around the letters of a text): the magnets
 * work on the part that is really there, so the letters snap to the middle and the sides of the frame, not their margins.
 */
export function snapViewCropped(raw: View, e: SnapEnv, crop?: Crop): Snap {
  const l = crop?.l ?? 0;
  const t = crop?.t ?? 0;
  const r = crop?.r ?? 0;
  const b = crop?.b ?? 0;
  if (!l && !t && !r && !b) return snapView(raw, e);
  const cw = e.sw * (1 - l - r);
  const ch = e.sh * (1 - t - b);
  const k = baseScale(cw, ch, e.W, e.H) / baseScale(e.sw, e.sh, e.W, e.H);
  const shift = (zoom: number, rot: number) => {
    const sc = baseScale(e.sw, e.sh, e.W, e.H) * zoom;
    const lx = ((l - r) / 2) * e.sw * sc;
    const ly = ((t - b) / 2) * e.sh * sc;
    const a = rot * RAD;
    return { x: lx * Math.cos(a) - ly * Math.sin(a), y: lx * Math.sin(a) + ly * Math.cos(a) };
  };
  const o = shift(raw.zoom, raw.rot);
  const cur: View = { x: raw.x + o.x / e.W, y: raw.y + o.y / e.H, zoom: raw.zoom / k, rot: raw.rot };
  const s = snapView(cur, { ...e, sw: cw, sh: ch });
  const zoom = s.view.zoom * k;
  const o2 = shift(zoom, s.view.rot);
  return { ...s, view: { x: s.view.x - o2.x / e.W, y: s.view.y - o2.y / e.H, zoom, rot: s.view.rot } };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box (canvas units) of the part of a picture that shows: its view, with the crop applied. */
export function shownBox(v: View, crop: Crop | undefined, sw: number, sh: number, W: number, H: number): Rect {
  const l = crop?.l ?? 0;
  const t = crop?.t ?? 0;
  const r = crop?.r ?? 0;
  const b = crop?.b ?? 0;
  const sc = baseScale(sw, sh, W, H) * v.zoom;
  const pw = sw * sc;
  const ph = sh * sc;
  const a = v.rot * RAD;
  const cx = W / 2 + v.x * W;
  const cy = H / 2 + v.y * H;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [lx, ly] of [
    [-pw / 2 + l * pw, -ph / 2 + t * ph],
    [pw / 2 - r * pw, -ph / 2 + t * ph],
    [pw / 2 - r * pw, ph / 2 - b * ph],
    [-pw / 2 + l * pw, ph / 2 - b * ph],
  ] as [number, number][]) {
    const px = cx + lx * Math.cos(a) - ly * Math.sin(a);
    const py = cy + lx * Math.sin(a) + ly * Math.cos(a);
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Which part of the canvas a double-tap aims at. The canvas is cut into a 3x3 grid, numbered 1 to 9 from the top left
 * (1 2 3 / 4 5 6 / 7 8 9) and the cell that was tapped decides: the middle (5) is the whole canvas, the middle of a side
 * (2, 4, 6, 8) is that half, and a corner (1, 3, 7, 9) is that quarter.
 */
export function tapCell(px: number, py: number, W: number, H: number): Rect {
  const col = Math.max(0, Math.min(2, Math.floor((px / W) * 3)));
  const row = Math.max(0, Math.min(2, Math.floor((py / H) * 3)));
  const x = col === 0 ? 0 : col === 2 ? W / 2 : 0;
  const y = row === 0 ? 0 : row === 2 ? H / 2 : 0;
  const w = col === 1 ? W : W / 2;
  const h = row === 1 ? H : H / 2;
  return { x, y, w, h };
}

/**
 * Double-tap on a picture that aims at part of the canvas: first it fits the shown part into that rectangle,
 * then it fills the rectangle and crops what sticks out, so it is exactly the size of the rectangle; a third tap
 * un-crops and fits again. The picture is turned to the nearest quarter turn first (a crop can only follow the picture's own sides).
 */
export function fitSegment(v: View, crop: Crop | undefined, base: Crop | undefined, sw: number, sh: number, W: number, H: number, T: Rect): { view: View; crop: Crop | undefined; mode: 'Fit' | 'Fill' } {
  const q = ((Math.round(normAngle(v.rot) / 90) % 4) + 4) % 4;
  const rot = q * 90;
  const odd = q % 2 === 1;
  const place = (zoom: number, c: Crop | undefined): View => {
    const l = c?.l ?? 0;
    const t = c?.t ?? 0;
    const r = c?.r ?? 0;
    const b = c?.b ?? 0;
    const sc = baseScale(sw, sh, W, H) * zoom;
    const lx = ((l - r) / 2) * sw * sc;
    const ly = ((t - b) / 2) * sh * sc;
    const a = rot * RAD;
    const ox = lx * Math.cos(a) - ly * Math.sin(a);
    const oy = lx * Math.sin(a) + ly * Math.cos(a);
    return { x: (T.x + T.w / 2 - ox - W / 2) / W, y: (T.y + T.h / 2 - oy - H / 2) / H, zoom, rot };
  };
  const keptAt = (zoom: number, c: Crop | undefined) => {
    const sc = baseScale(sw, sh, W, H) * zoom;
    const kw = sw * (1 - (c?.l ?? 0) - (c?.r ?? 0)) * sc;
    const kh = sh * (1 - (c?.t ?? 0) - (c?.b ?? 0)) * sc;
    return odd ? { w: kh, h: kw } : { w: kw, h: kh };
  };
  const cur = shownBox(v, crop, sw, sh, W, H);
  const tol = 0.01 * Math.max(T.w, T.h) + 0.5;
  const centered = Math.abs(cur.x + cur.w / 2 - (T.x + T.w / 2)) < tol && Math.abs(cur.y + cur.h / 2 - (T.y + T.h / 2)) < tol;
  const exact = centered && Math.abs(cur.w - T.w) < tol && Math.abs(cur.h - T.h) < tol;
  const fitted = centered && cur.w <= T.w + tol && cur.h <= T.h + tol && (Math.abs(cur.w - T.w) < tol || Math.abs(cur.h - T.h) < tol);
  const fitTo = (c: Crop | undefined) => {
    const k = keptAt(1, c);
    const zoom = Math.min(T.w / k.w, T.h / k.h);
    return { view: place(zoom, c), crop: c, mode: 'Fit' as const };
  };
  const same = (a?: Crop, b?: Crop) => (a?.l ?? 0) === (b?.l ?? 0) && (a?.t ?? 0) === (b?.t ?? 0) && (a?.r ?? 0) === (b?.r ?? 0) && (a?.b ?? 0) === (b?.b ?? 0);
  if (exact && !same(crop, base)) return fitTo(base); // cropped to the rectangle: undo the crop and fit again
  if (!fitted || exact) return fitTo(crop);
  // fitted: grow to cover the rectangle and cut off what sticks out
  const k = keptAt(1, crop);
  const zoom = Math.max(T.w / k.w, T.h / k.h);
  const kz = keptAt(zoom, crop);
  const sc = baseScale(sw, sh, W, H) * zoom;
  const overX = Math.max(0, (kz.w - T.w) / 2); // canvas units off each side, left and right
  const overY = Math.max(0, (kz.h - T.h) / 2);
  const dl = (odd ? overY : overX) / sc / sw; // as a share of the picture's own width
  const dt = (odd ? overX : overY) / sc / sh;
  const c: Crop = { l: (crop?.l ?? 0) + dl, r: (crop?.r ?? 0) + dl, t: (crop?.t ?? 0) + dt, b: (crop?.b ?? 0) + dt };
  return { view: place(zoom, c), crop: c, mode: 'Fill' };
}
