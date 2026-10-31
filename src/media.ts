import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaInfo } from './types.ts';

export class UnsupportedMediaError extends Error {}

interface Entry {
  blob: Blob;
  url: string;
  thumbUrl: string;
}
const entries = new Map<string, Entry>();

export function registerMedia(id: string, blob: Blob, thumb: Blob | null): void {
  dropMedia(id);
  entries.set(id, { blob, url: URL.createObjectURL(blob), thumbUrl: thumb ? URL.createObjectURL(thumb) : '' });
}

export function dropMedia(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  URL.revokeObjectURL(e.url);
  if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
  entries.delete(id);
}

export function dropAllMedia(): void {
  [...entries.keys()].forEach(dropMedia);
}

export const mediaBlob = (id: string): Blob | undefined => entries.get(id)?.blob;
export const mediaUrl = (id: string): string | undefined => entries.get(id)?.url;
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
