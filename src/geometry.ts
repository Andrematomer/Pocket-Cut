import type { Crop, Project, Rotation } from './types.ts';

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_CROP = 0.08;

export function rotatedSize(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/** Crop rectangle in pixels of the rotated frame. */
export function cropPixels(rw: number, rh: number, crop: Crop | null): { x: number; y: number; w: number; h: number } {
  const c = crop ?? FULL_CROP;
  return { x: c.x * rw, y: c.y * rh, w: c.w * rw, h: c.h * rh };
}

export function clampCrop(c: Crop): Crop {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

/** Rotating a clip by 90° clockwise carries its crop rectangle along. */
export function rotateCrop(c: Crop | null, dir: 'cw' | 'ccw'): Crop | null {
  if (!c) return null;
  return dir === 'cw' ? { x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
}

/** Largest centered crop with the given aspect (w/h) inside a rotated frame of rw x rh pixels. */
export function cropForAspect(rw: number, rh: number, aspect: number): Crop {
  let w: number;
  let h: number;
  if (rw / rh > aspect) {
    h = 1;
    w = (aspect * rh) / rw;
  } else {
    w = 1;
    h = rw / (aspect * rh);
  }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

export interface FrameTransform {
  /** where the center of the source frame lands on the output canvas */
  tx: number;
  ty: number;
  /** radians, clockwise */
  angle: number;
  scale: number;
  /** area of the canvas the picture covers */
  dest: { x: number; y: number; w: number; h: number };
}

export interface DrawOptions {
  rotation: Rotation;
  crop: Crop | null;
  outW: number;
  outH: number;
  fit: 'contain' | 'cover';
}

/**
 * Pure maths for placing a source frame (sw x sh) onto an output canvas. Preview and export both
 * go through this, so what you see is what you get.
 */
export function frameTransform(sw: number, sh: number, o: DrawOptions): FrameTransform {
  const { w: rw, h: rh } = rotatedSize(sw, sh, o.rotation);
  const cp = cropPixels(rw, rh, o.crop);
  const scale = o.fit === 'cover' ? Math.max(o.outW / cp.w, o.outH / cp.h) : Math.min(o.outW / cp.w, o.outH / cp.h);
  const dw = cp.w * scale;
  const dh = cp.h * scale;
  const ccx = cp.x + cp.w / 2;
  const ccy = cp.y + cp.h / 2;
  return {
    tx: o.outW / 2 + scale * (rw / 2 - ccx),
    ty: o.outH / 2 + scale * (rh / 2 - ccy),
    angle: (o.rotation * Math.PI) / 180,
    scale,
    dest: { x: (o.outW - dw) / 2, y: (o.outH - dh) / 2, w: dw, h: dh },
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
  ctx.beginPath();
  ctx.rect(t.dest.x, t.dest.y, t.dest.w, t.dest.h);
  ctx.clip();
  ctx.translate(t.tx, t.ty);
  ctx.rotate(t.angle);
  ctx.scale(t.scale, t.scale);
  ctx.translate(-sw / 2, -sh / 2);
  ctx.drawImage(src, 0, 0, sw, sh);
  ctx.restore();
}

export const ASPECT_VALUE: Record<string, number> = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1, '16:9': 16 / 9 };

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size in pixels for a project. 'auto' follows the first clip's cropped shape. */
export function outputSize(p: Project): { w: number; h: number } {
  const s = p.settings;
  let aspect = 9 / 16;
  if (s.aspect !== 'auto') aspect = ASPECT_VALUE[s.aspect]!;
  else {
    const first = p.clips[0];
    const m = first ? p.media[first.mediaId] : undefined;
    if (first && m) {
      const r = rotatedSize(m.width, m.height, first.rotation);
      const cp = cropPixels(r.w, r.h, first.crop);
      if (cp.w > 0 && cp.h > 0) aspect = cp.w / cp.h;
    }
  }
  const short = s.resolution;
  return aspect <= 1 ? { w: even(short), h: even(short / aspect) } : { w: even(short * aspect), h: even(short) };
}

/** Drags one corner of the crop box by (dx, dy) (normalized units), optionally keeping the aspect. */
export function resizeCrop(
  c: Crop,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  dx: number,
  dy: number,
  aspect: number | null,
  rw: number,
  rh: number,
): Crop {
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const ax = left ? c.x + c.w : c.x; // the opposite corner stays put
  const ay = top ? c.y + c.h : c.y;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const px = clamp01((left ? c.x : c.x + c.w) + dx);
  const py = clamp01((top ? c.y : c.y + c.h) + dy);
  let w = Math.abs(px - ax);
  let h = Math.abs(py - ay);
  const roomW = left ? ax : 1 - ax;
  const roomH = top ? ay : 1 - ay;
  if (aspect) {
    const k = rw / (aspect * rh); // h = w * k
    if (h > w * k) w = h / k;
    else h = w * k;
    const maxW = Math.min(roomW, roomH / k);
    if (w > maxW) {
      w = maxW;
      h = w * k;
    }
    if (w < MIN_CROP) {
      w = MIN_CROP;
      h = w * k;
    }
    if (h < MIN_CROP) {
      h = MIN_CROP;
      w = h / k;
    }
  } else {
    w = Math.min(roomW, Math.max(MIN_CROP, w));
    h = Math.min(roomH, Math.max(MIN_CROP, h));
  }
  return { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
}
