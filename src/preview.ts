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
      fit: this.editCrop ? 'contain' : cur.clip.fit,
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
    const v = this.video;
    v.preservesPitch = clip.keepPitch;
    (v as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = clip.keepPitch;
    v.playbackRate = clip.speed;
    v.defaultPlaybackRate = clip.speed;
    v.muted = clip.muted;
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

  /** timeline clock: playback time is measured here, not read back from the video element */
  private clockT0 = 0;
  private clockTl0 = 0;
  private seeking = false;

  private startClock(tl: number): void {
    this.clockT0 = performance.now();
    this.clockTl0 = tl;
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
    this.startClock(this.tl);
    if (this.nativeRate(cur.clip)) {
      try {
        await this.video.play();
      } catch {
        this.playing = false;
        this.deps.onPlaying(false);
        return;
      }
    }
    if (tok !== this.token) return;
    this.startClock(this.tl);
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

  /** false when the browser did not accept this speed for the video element (then frames are stepped by seeking) */
  private nativeRate(clip: Clip): boolean {
    return Math.abs(this.video.playbackRate - clip.speed) < 1e-3;
  }

  private loop(tok: number): void {
    this.raf = requestAnimationFrame(() => void this.step(tok));
  }

  /**
   * One animation frame of playback. The timeline position comes from a clock, so a clip at 4x
   * really takes a quarter of the time. The video element follows: it runs at the clip's speed
   * when the browser allows that, and is re-synced by seeking whenever it drifts.
   */
  private async step(tok: number): Promise<void> {
    if (tok !== this.token || !this.playing) return;
    const p = this.deps.getProject();
    if (p.clips.length === 0) return this.pause();
    const L = layout(p.clips);
    const v = this.video;
    const tl = this.clockTl0 + (performance.now() - this.clockT0) / 1000;

    if (tl >= L.total - 1e-3) {
      this.playing = false;
      v.pause();
      this.tl = L.total;
      this.draw();
      this.deps.onTime(this.tl);
      this.deps.onPlaying(false);
      return;
    }

    const at = locate(L, tl)!;
    const clip = p.clips[at.index]!;

    if (at.index !== this.idx) {
      // crossing into the next clip
      this.idx = at.index;
      v.pause();
      if (clip.mediaId !== this.media && (!(await this.load(clip.mediaId)) || tok !== this.token)) return;
      this.applyClip(clip);
      await this.seekVideo(sourceTimeAt(clip, at.local));
      if (tok !== this.token) return;
      if (this.nativeRate(clip)) {
        try {
          await v.play();
        } catch {
          return this.pause();
        }
      }
      if (tok !== this.token) return;
      this.startClock(L.starts[at.index]! + at.local);
      this.draw();
      this.loop(tok);
      return;
    }

    // keep the picture in step with the clock
    const want = Math.min(sourceTimeAt(clip, at.local), Math.max(clip.start, clip.end - 0.001));
    this.applyClip(clip);
    if (this.nativeRate(clip)) {
      if (v.paused && !this.seeking) void v.play().catch(() => {});
      if (!this.seeking && Math.abs(v.currentTime - want) > 0.3) {
        this.seeking = true;
        void this.seekVideo(want).then(() => (this.seeking = false));
      }
    } else if (!this.seeking) {
      // the browser keeps its own speed: step through the clip by seeking to where the clock says we are
      if (!v.paused) v.pause();
      this.seeking = true;
      void this.seekVideo(want).then(() => (this.seeking = false));
    }

    this.tl = tl;
    this.draw();
    this.deps.onTime(this.tl);
    this.loop(tok);
  }
}
