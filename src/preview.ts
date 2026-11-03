import { bakedAudio } from './bake.ts';
import { drawFrame } from './geometry.ts';
import { layout, locate, sourceTimeAt } from './timeline.ts';
import type { Clip, Project, View } from './types.ts';

export interface PreviewDeps {
  getProject(): Project;
  getUrl(mediaId: string): string | undefined;
  /** the decoded picture when the clip is a still image */
  getImage(mediaId: string): ImageBitmap | undefined;
  /** the original file (its sound is what gets baked for the preview) */
  getBlob(mediaId: string): Blob | undefined;
  onTime(t: number): void;
  onPlaying(playing: boolean): void;
}

/**
 * Preview player. One hidden <video> element decodes the clip being shown; every frame is painted
 * onto the canvas with the same drawFrame() the exporter uses, so the preview matches the result.
 * Stitched clips are played one after another (a short pause at a cut between two different
 * files is normal here; the exported video has no gap). Still pictures are drawn from memory and
 * timed by a clock.
 *
 * Timing: while the video element plays at the clip's speed by itself, the timeline follows the
 * video (never fighting it with seeks, which would cut the sound). If the browser ignores the speed
 * (some iPhones do), the timeline follows a clock and the picture is stepped by seeking.
 */
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class PreviewEngine {
  readonly video = document.createElement('video');
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private media: string | null = null;
  private loadedUrl = '';
  private token = 0;
  private raf = 0;
  private idx = 0;
  tl = 0;
  playing = false;
  /** while a finger is moving the picture, this view is drawn instead of the saved one */
  live: { index: number; view: View } | null = null;

  /** timeline clock, used for pictures and when the video can't run at the clip's speed */
  private clockMode = false;
  private clockT0 = 0;
  private clockTl0 = 0;
  private seeking = false;
  /** measures whether the video really advances at the clip's speed */
  private rate = { wall: 0, vt: 0, checked: false };

  constructor(private deps: PreviewDeps) {
    const v = this.video;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.preservesPitch = true;
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    // keep the phone from treating the preview as a media player (AirPlay picker, lock-screen controls)
    v.disableRemotePlayback = true;
    v.setAttribute('x-webkit-airplay', 'deny');
    document.body.appendChild(v);
    // a Web Audio context only starts after a touch: wake it on every one, so the sound never stays muted
    const wake = () => this.wakeAudio();
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchend', wake, { passive: true });
    // leaving the app: release the audio session; coming back: wake it and repaint (iOS may have dropped the canvas)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        void this.audio?.ctx.suspend().catch(() => {});
        void this.baked?.ctx.suspend().catch(() => {});
      } else {
        this.wakeAudio();
        requestAnimationFrame(() => this.draw());
      }
    });
    this.hideFromLockScreen();
    v.addEventListener('play', () => this.hideFromLockScreen());
  }

  /** best effort: an empty "now playing" entry. iOS may still show a bare player while sound plays. */
  private hideFromLockScreen(): void {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      ms.metadata = null;
      for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto', 'stop'] as MediaSessionAction[]) ms.setActionHandler(a, null);
    } catch {
      /* some actions are not known to this browser */
    }
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

  /** the clip that is on screen right now */
  currentIndex(): number {
    return this.current()?.index ?? 0;
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
    const cur = this.current();
    const v = this.video;
    const black = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    if (!cur) return black();
    const o = { outW: canvas.width, outH: canvas.height, view: this.live && this.live.index === cur.index ? this.live.view : cur.clip.view };
    const img = this.deps.getImage(cur.clip.mediaId);
    if (img) return drawFrame(ctx, img, img.width, img.height, o);
    if (v.readyState < 2 || !v.videoWidth || this.media !== cur.clip.mediaId) return black();
    drawFrame(ctx, v, v.videoWidth, v.videoHeight, o);
  }

  private isImage(clip: Clip): boolean {
    return !!this.deps.getImage(clip.mediaId);
  }

  private async load(mediaId: string): Promise<boolean> {
    const v = this.video;
    const url = this.deps.getUrl(mediaId);
    if (!url) return false;
    if (this.media === mediaId && this.loadedUrl === url && v.readyState >= 1) return true;
    this.media = mediaId;
    this.loadedUrl = url;
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
    this.applyVolume(clip.volume);
  }

  private audio: { ctx: AudioContext; gain: GainNode } | null = null;

  // ---- baked sound for clips that are not at normal speed ----
  /** true while the video is kept silent because the clip's sound plays from a baked buffer */
  private bakedActive = false;
  private baked: { ctx: AudioContext; gain: GainNode; src: AudioBufferSourceNode | null } | null = null;

  private bakedCtx(): { ctx: AudioContext; gain: GainNode; src: AudioBufferSourceNode | null } | null {
    if (!this.baked) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        this.baked = { ctx, gain, src: null };
      } catch {
        return null;
      }
    }
    return this.baked;
  }

  private stopBaked(): void {
    const b = this.baked;
    if (b?.src) {
      try {
        b.src.stop();
      } catch {
        /* already stopped */
      }
      b.src.disconnect();
      b.src = null;
    }
  }

  /** plays the baked sound of `clip` from `local` seconds into it (timeline seconds, i.e. after speed) */
  private wantsBaked(clip: Clip): boolean {
    const media = this.deps.getProject().media[clip.mediaId];
    return !!media?.hasAudio && !!this.deps.getBlob(clip.mediaId) && !this.isImage(clip) && Math.abs(clip.speed - 1) > 1e-3;
  }

  private async startBaked(clip: Clip, tok: number): Promise<void> {
    this.stopBaked();
    const blob = this.deps.getBlob(clip.mediaId);
    if (!this.bakedActive || !blob) return;
    const buf = await bakedAudio(blob, clip);
    if (tok !== this.token || !this.playing) return;
    const b = buf ? this.bakedCtx() : null;
    if (!buf || !b) {
      // nothing to bake from: let the video's own sound do what it can
      this.bakedActive = false;
      this.applyVolume(clip.volume);
      return;
    }
    // the video may have moved on while the sound was being made: start where the clip really is
    const cur = this.current();
    const L = layout(this.deps.getProject().clips);
    const at = cur ? Math.max(0, this.tl - L.starts[cur.index]!) : 0;
    void b.ctx.resume().catch(() => {});
    const src = b.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(b.gain);
    b.gain.gain.value = clip.volume;
    if (at < buf.duration) src.start(0, at);
    b.src = src;
  }

  /**
   * Sets the loudness of the preview. Most browsers let a page set video.volume. iPhones do not (it
   * is read-only there), so on iOS the sound is always routed through Web Audio and turned down by a
   * gain node. Elsewhere that route is only used when the browser ignores video.volume.
   */
  applyVolume(vol: number): void {
    const v = this.video;
    v.muted = vol <= 0 || this.bakedActive;
    if (this.baked) this.baked.gain.gain.value = vol;
    if (this.audio) {
      this.audio.gain.gain.value = vol;
      return;
    }
    try {
      v.volume = vol;
    } catch {
      /* read-only on some browsers */
    }
    const ignored = IOS || (vol < 1 && Math.abs(v.volume - vol) > 0.02);
    if (!ignored) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      ctx.createMediaElementSource(v).connect(gain).connect(ctx.destination);
      gain.gain.value = vol;
      this.audio = { ctx, gain };
      void ctx.resume().catch(() => {});
    } catch {
      /* no way to change the loudness here: the preview stays at full volume, the export is still right */
    }
  }

  /** whether the preview loudness really follows the volume setting in this browser */
  volumeWorks(): boolean {
    if (this.audio) return this.audio.ctx.state === 'running' || this.audio.ctx.state === 'suspended';
    return !IOS;
  }

  /** call from a tap: a Web Audio context only starts after a gesture */
  wakeAudio(): void {
    void this.audio?.ctx.resume().catch(() => {});
    void this.baked?.ctx.resume().catch(() => {});
  }

  /** false when the browser did not accept this speed for the video element */
  private nativeRate(clip: Clip): boolean {
    return Math.abs(this.video.playbackRate - clip.speed) < 1e-3;
  }

  private startClock(tl: number): void {
    this.clockT0 = performance.now();
    this.clockTl0 = tl;
  }

  /**
   * A preview copy appeared or went away, so the address of the loaded video changed (and the old one
   * may already be revoked). Drop what is loaded and show the current frame again from the new source.
   */
  refresh(): void {
    const t = this.tl;
    const was = this.playing;
    this.token++;
    this.stopPlaying();
    this.media = null;
    this.loadedUrl = '';
    if (!this.deps.getProject().clips.length) return;
    void this.showAt(t).then(() => was && void this.play());
  }

  /** Pause and show the frame at timeline time t. */
  async showAt(t: number): Promise<void> {
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
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
    if (this.isImage(clip)) {
      this.draw();
      this.deps.onTime(this.tl);
      return;
    }
    if (!(await this.load(clip.mediaId)) || tok !== this.token) return;
    await this.seekVideo(Math.min(sourceTimeAt(clip, at.local), Math.max(clip.start, clip.end - 0.001)));
    if (tok !== this.token) return;
    this.applyClip(clip);
    this.draw();
    this.deps.onTime(this.tl);
  }

  private stopPlaying(): void {
    this.stopBaked();
    if (this.playing) {
      this.playing = false;
      this.video.pause();
      this.deps.onPlaying(false);
    }
  }

  // ---- scrubbing by source time (trim handles and the trim bar) ----

  private scrubTarget: { index: number; t: number; report: boolean } | null = null;
  private scrubbing = false;

  /**
   * Shows the frame at `srcT` (seconds in the source file) of clip `index`, without touching the
   * project. Rapid calls are merged: only the newest target is ever seeked to, so dragging a finger
   * never builds up a queue of seeks.
   */
  scrubSource(index: number, srcT: number, report: boolean): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
    this.scrubTarget = { index, t: srcT, report };
    if (!this.scrubbing) void this.pumpScrub();
  }

  private async pumpScrub(): Promise<void> {
    this.scrubbing = true;
    try {
      while (this.scrubTarget) {
        const tg = this.scrubTarget;
        this.scrubTarget = null;
        const p = this.deps.getProject();
        const clip = p.clips[tg.index];
        if (!clip) continue;
        this.idx = tg.index;
        if (!this.isImage(clip)) {
          if (!(await this.load(clip.mediaId))) continue;
          await this.seekVideo(Math.max(0, tg.t));
        }
        this.draw();
        if (tg.report) {
          const L = layout(p.clips);
          this.tl = L.starts[tg.index]! + Math.max(0, Math.min(L.durations[tg.index]!, (tg.t - clip.start) / clip.speed));
          this.deps.onTime(this.tl);
        }
      }
    } finally {
      this.scrubbing = false;
    }
  }

  // ---- playback ----

  async play(): Promise<void> {
    this.wakeAudio();
    const clips = this.deps.getProject().clips;
    if (clips.length === 0) return;
    const L = layout(clips);
    if (this.tl >= L.total - 0.05) this.tl = 0;
    await this.showAt(this.tl);
    const tok = ++this.token;
    const cur = this.current();
    if (!cur) return;
    this.playing = true;
    this.deps.onPlaying(true);
    if (!(await this.beginClip(cur.clip, this.tl, tok))) return;
    this.loop(tok);
  }

  /** starts the clip's own playback; false if playback was refused or superseded */
  private async beginClip(clip: Clip, tl: number, tok: number): Promise<boolean> {
    const v = this.video;
    this.startClock(tl);
    this.rate = { wall: performance.now(), vt: v.currentTime, checked: false };
    if (this.isImage(clip)) {
      v.pause();
      this.clockMode = true;
      this.bakedActive = false;
      this.stopBaked();
      return true;
    }
    this.bakedActive = this.wantsBaked(clip);
    this.applyClip(clip);
    this.clockMode = !this.nativeRate(clip);
    if (!this.clockMode) {
      try {
        await v.play();
      } catch {
        this.playing = false;
        this.deps.onPlaying(false);
        return false;
      }
      if (tok !== this.token) return false;
      this.startClock(tl);
      this.rate = { wall: performance.now(), vt: v.currentTime, checked: false };
    } else {
      v.pause();
    }
    void this.startBaked(clip, tok);
    return true;
  }

  pause(): void {
    this.token++;
    this.stopBaked();
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
    const v = this.video;
    const now = performance.now();
    const img = this.isImage(clip);
    const byClock = img || this.clockMode;

    let tl: number;
    let finished: boolean;
    if (byClock) {
      tl = this.clockTl0 + (now - this.clockT0) / 1000;
      finished = tl >= L.starts[index]! + L.durations[index]! - 1e-3;
    } else {
      tl = L.starts[index]! + Math.max(0, (v.currentTime - clip.start) / clip.speed);
      finished = v.currentTime >= clip.end - 0.03 || v.ended;
    }

    if (finished) {
      if (index + 1 < p.clips.length) {
        const next = p.clips[index + 1]!;
        this.idx = index + 1;
        this.tl = L.starts[index + 1]!;
        v.pause();
        if (!this.isImage(next)) {
          if (!(await this.load(next.mediaId)) || tok !== this.token) return;
          await this.seekVideo(next.start);
          if (tok !== this.token) return;
        }
        if (!(await this.beginClip(next, this.tl, tok))) return;
        this.draw();
        this.loop(tok);
        return;
      }
      this.playing = false;
      v.pause();
      this.tl = L.total;
      this.draw();
      this.deps.onTime(this.tl);
      this.deps.onPlaying(false);
      return;
    }

    if (!img) {
      if (this.clockMode) {
        // the browser keeps its own speed: show the frame where the clock says we are
        if (!this.seeking) {
          const want = Math.min(sourceTimeAt(clip, Math.max(0, tl - L.starts[index]!)), Math.max(clip.start, clip.end - 0.001));
          this.seeking = true;
          void this.seekVideo(want).then(() => (this.seeking = false));
        }
      } else if (!this.rate.checked && now - this.rate.wall > 800) {
        // does the video really run at the clip's speed? If it runs at normal speed instead, switch to the clock
        this.rate.checked = true;
        const measured = (v.currentTime - this.rate.vt) / ((now - this.rate.wall) / 1000);
        if (Math.abs(clip.speed - 1) > 0.2 && Math.abs(measured - 1) < 0.2) {
          this.clockMode = true;
          this.startClock(tl);
          v.pause();
        }
      }
    }

    this.tl = tl;
    this.draw();
    this.deps.onTime(this.tl);
    this.loop(tok);
  }
}
