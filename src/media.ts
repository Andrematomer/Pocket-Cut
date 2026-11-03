import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaInfo } from './types.ts';

export class UnsupportedMediaError extends Error {}

interface Entry {
  blob: Blob;
  url: string;
  thumbUrl: string;
  thumb: Blob | null;
  name: string;
  /** small copy of a video used only for the on-screen preview (never for export) */
  proxy: Blob | null;
  proxyUrl: string;
  bitmap: ImageBitmap | null;
}
const entries = new Map<string, Entry>();

export function registerMedia(id: string, blob: Blob, thumb: Blob | null, extra: { name?: string; proxy?: Blob | null; bitmap?: ImageBitmap | null } = {}): void {
  dropMedia(id);
  const proxy = extra.proxy ?? null;
  entries.set(id, {
    blob,
    url: URL.createObjectURL(blob),
    thumbUrl: thumb ? URL.createObjectURL(thumb) : '',
    thumb,
    name: extra.name ?? '',
    proxy,
    proxyUrl: proxy ? URL.createObjectURL(proxy) : '',
    bitmap: extra.bitmap ?? null,
  });
}

/** Attaches the small preview copy once it has been made. Returns false if the clip was removed meanwhile. */
export function setProxy(id: string, proxy: Blob): boolean {
  const e = entries.get(id);
  if (!e) return false;
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.proxy = proxy;
  e.proxyUrl = URL.createObjectURL(proxy);
  return true;
}
/** Forgets the small preview copy. Returns true if there was a video that can get a new one. */
export function clearProxy(id: string): boolean {
  const e = entries.get(id);
  if (!e || e.bitmap) return false;
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.proxy = null;
  e.proxyUrl = '';
  return true;
}
export const mediaEntry = (id: string): Entry | undefined => entries.get(id);
export const mediaBitmap = (id: string): ImageBitmap | undefined => entries.get(id)?.bitmap ?? undefined;

export function dropMedia(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  URL.revokeObjectURL(e.url);
  if (e.proxyUrl) URL.revokeObjectURL(e.proxyUrl);
  e.bitmap?.close();
  if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
  entries.delete(id);
}

export function dropAllMedia(): void {
  [...entries.keys()].forEach(dropMedia);
}

export const mediaBlob = (id: string): Blob | undefined => entries.get(id)?.blob;
/** What the preview plays: the small copy when it exists, else the original. */
export const mediaUrl = (id: string): string | undefined => entries.get(id)?.proxyUrl || entries.get(id)?.url;
export const thumbUrl = (id: string): string | undefined => entries.get(id)?.thumbUrl || undefined;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const newId = uid;

/** Reads duration, size and sound info, and grabs a first-frame thumbnail. */
export async function probeVideo(file: File, id: string): Promise<{ info: MediaInfo; thumb: Blob | null }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new UnsupportedMediaError(`"${file.name}" has no video in it.`);
    if (!(await vt.canDecode())) {
      throw new UnsupportedMediaError(`This device can't read the video format of "${file.name}".`);
    }
    const duration = await input.computeDuration();
    const width = await vt.getDisplayWidth();
    const height = await vt.getDisplayHeight();
    if (!(duration > 0) || !width || !height) throw new UnsupportedMediaError(`"${file.name}" looks empty or damaged.`);

    const at = await input.getPrimaryAudioTrack();
    const hasAudio = !!at && (await at.canDecode());

    let thumb: Blob | null = null;
    try {
      const scale = Math.min(1, 240 / Math.max(width, height));
      const sink = new CanvasSink(vt, { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)), fit: 'fill' });
      const first = await sink.getCanvas(await vt.getFirstTimestamp());
      if (first) thumb = await canvasToJpeg(first.canvas);
    } catch {
      thumb = null; // no thumbnail is fine
    }
    return { info: { id, name: file.name.replace(/\.[^.]+$/, ''), duration, width, height, hasAudio }, thumb };
  } finally {
    input.dispose();
  }
}

async function canvasToJpeg(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if (c instanceof OffscreenCanvas) return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
}

export const IMAGE_MAX_SECONDS = 30;
export const IMAGE_DEFAULT_SECONDS = 5;

export const isImageFile = (f: File): boolean => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name);

/** Decodes a still picture (upright, large ones scaled down to at most 4096 px). */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  let bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const big = Math.max(bmp.width, bmp.height);
  if (big > 4096) {
    const k = 4096 / big;
    const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' });
    bmp.close();
    bmp = small;
  }
  return bmp;
}

export async function probeImage(file: File, id: string): Promise<{ info: MediaInfo; thumb: Blob | null; bitmap: ImageBitmap }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeImage(file);
  } catch {
    throw new UnsupportedMediaError(`This device can't read the picture "${file.name}".`);
  }
  let thumb: Blob | null = null;
  try {
    const k = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(bitmap.width * k));
    c.height = Math.max(2, Math.round(bitmap.height * k));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    thumb = await canvasToJpeg(c);
  } catch {
    thumb = null;
  }
  return { info: { id, name: file.name.replace(/\.[^.]+$/, ''), duration: IMAGE_MAX_SECONDS, width: bitmap.width, height: bitmap.height, hasAudio: false, kind: 'image' }, thumb, bitmap };
}
