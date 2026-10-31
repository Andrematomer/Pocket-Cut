import { drawFrame } from './geometry.ts';
import { layout, locate, sourceTimeAt } from './timeline.ts';
import type { Clip, Project } from './types.ts';

export interface PreviewDeps {
  getProject(): Project;
  getUrl(mediaId: string): string | undefined;
  onTime(t: number): void;
  onPlaying(playing: boolean): void;
}

/**
 * Preview player. One hidden <video> element decodes the clip being shown; every frame is painted
 * onto the canvas with the same drawFrame() the exporter uses, so the preview matches the result.
 * Stitched clips are played one after another (a short pause at a cut between two different
 * files is normal here; the exported video has no gap).
 */
export class PreviewEngine {
  readonly video = document.createElement('video');
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private media: string | null = null;
  private token = 0;
  private raf = 0;
  private idx = 0;
  tl = 0;
  playing = false;
  /** show the whole rotated frame (no crop) so the crop box can be edited on top */
  editCrop = false;

  constructor(private deps: PreviewDeps) {
    const v = this.video;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.preservesPitch = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.draw();
  }

  destroy(): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }

  private current(): { clip: Clip; index: number } | null {
    const clips = this.deps.getProject().clips;
    const i = Math.min(this.idx, clips.length - 1);
    return clips[i] ? { clip: clips[i]!, index: i } : null;
  }

  draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    const p = this.deps.getProject();
    const cur = this.current();
    const v = this.video;
    if (!cur || v.readyState < 2 || !v.videoWidth || this.media !== cur.clip.mediaId) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawFrame(ctx, v, v.videoWidth, v.videoHeight, {
      rotation: cur.clip.rotation,
      crop: this.editCrop ? null : cur.clip.crop,
      outW: canvas.width,
      outH: canvas.height,
      fit: this.editCrop ? 'contain' : p.settings.fit,
    });
  }

  private async load(mediaId: string): Promise<boolean> {
    const v = this.video;
    if (this.media === mediaId && v.readyState >= 1) return true;
    const url = this.deps.getUrl(mediaId);
    if (!url) return false;
    this.media = mediaId;
    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        v.removeEventListener('loadeddata', onOk);
        v.removeEventListener('error', onErr);
        resolve(ok);
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      v.addEventListener('loadeddata', onOk);
      v.addEventListener('error', onErr);
      v.src = url;
      v.load();
    });
  }

  private seekVideo(time: number): Promise<void> {
    const v = this.video;
    return new Promise((resolve) => {
      if (Math.abs(v.currentTime - time) < 0.002 && v.readyState >= 2) return resolve();
      const on = () => {
        v.removeEventListener('seeked', on);
        resolve();
      };
      v.addEventListener('seeked', on);
      v.currentTime = time;
    });
  }

  private applyClip(clip: Clip): void {
    this.video.playbackRate = clip.speed;
    this.video.defaultPlaybackRate = clip.speed;
    this.video.muted = clip.muted;
  }

  /** Pause and show the frame at timeline time t. */
  async showAt(t: number): Promise<void> {
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    if (this.playing) {
      this.playing = false;
      this.video.pause();
      this.deps.onPlaying(false);
    }
    const L = layout(this.deps.getProject().clips);
    const at = locate(L, t);
    if (!at) {
      this.media = null;
      this.tl = 0;
      this.draw();
      return;
    }
    this.idx = at.index;
    this.tl = Math.min(t, L.total);
    const clip = this.deps.getProject().clips[at.index]!;
    if (!(await this.load(clip.mediaId)) || tok !== this.token) return;
    await this.seekVideo(Math.min(sourceTimeAt(clip, at.local), Math.max(clip.start, clip.end - 0.001)));
    if (tok !== this.token) return;
    this.applyClip(clip);
    this.draw();
    this.deps.onTime(this.tl);
  }

  async play(): Promise<void> {
    const clips = this.deps.getProject().clips;
    if (clips.length === 0) return;
    const L = layout(clips);
    if (this.tl >= L.total - 0.05) this.tl = 0;
    await this.showAt(this.tl);
    const tok = ++this.token;
    const cur = this.current();
    if (!cur) return;
    this.applyClip(cur.clip);
    this.playing = true;
    this.deps.onPlaying(true);
    try {
      await this.video.play();
    } catch {
      this.playing = false;
      this.deps.onPlaying(false);
      return;
    }
    if (tok !== this.token) return;
    this.loop(tok);
  }

  pause(): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    if (!this.playing) return;
    this.playing = false;
    this.video.pause();
    this.deps.onPlaying(false);
  }

  private loop(tok: number): void {
    this.raf = requestAnimationFrame(() => void this.step(tok));
  }

  private async step(tok: number): Promise<void> {
    if (tok !== this.token || !this.playing) return;
    const p = this.deps.getProject();
    const cur = this.current();
    if (!cur) return this.pause();
    const L = layout(p.clips);
    const { clip, index } = cur;
    const ct = this.video.currentTime;
    if (ct >= clip.end - 0.03 || this.video.ended) {
      if (index + 1 < p.clips.length) {
        const next = p.clips[index + 1]!;
        this.idx = index + 1;
        this.tl = L.starts[index + 1]!;
        if (next.mediaId !== this.media) {
          this.video.pause();
          if (!(await this.load(next.mediaId)) || tok !== this.token) return;
        }
        await this.seekVideo(next.start);
        if (tok !== this.token) return;
        this.applyClip(next);
        try {
          await this.video.play();
        } catch {
          return this.pause();
        }
        this.draw();
        this.loop(tok);
        return;
      }
      this.playing = false;
      this.video.pause();
      this.tl = L.total;
      this.draw();
      this.deps.onTime(this.tl);
      this.deps.onPlaying(false);
      return;
    }
    this.tl = L.starts[index]! + Math.max(0, (ct - clip.start) / clip.speed);
    this.draw();
    this.deps.onTime(this.tl);
    this.loop(tok);
  }
}
