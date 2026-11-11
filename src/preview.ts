import { bakedAudio, keyOf } from './bake.ts';
import { drawLayer } from './layers.ts';
import { activeAt, clipEnd, sourceAt, totalOf } from './timeline.ts';
import type { Clip, Crop, Project, View } from './types.ts';

export interface PreviewDeps {
  getProject(): Project;
  getUrl(mediaId: string): string | undefined;
  /** the decoded picture when the clip is a still image */
  getImage(mediaId: string): ImageBitmap | undefined;
  /** the original file (its sound is what gets baked for the preview) */
  getBlob(mediaId: string): Blob | undefined;
  onTime(t: number): void;
  onPlaying(playing: boolean): void;
  /** what to do when playback reaches the end */
  getEnd(): 'pause' | 'stop' | 'loop' | 'return';
}

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
void IOS;

/** how many videos may be decoded at the same time (each one needs a hardware decoder on a phone) */
const POOL = 4;
/** videos about to start are loaded this many seconds ahead, so cuts do not stall */
const LOOKAHEAD = 1.5;
/** clips longer than this keep their own sound instead of a rendered copy (memory) */
const BAKE_MAX_SECONDS = 180;
/** the video may be this far from where the clock says before it is pulled back */
const DRIFT = 0.3;

interface Player {
  video: HTMLVideoElement;
  clipId: string | null;
  mediaId: string | null;
  url: string;
  ready: boolean;
  /** source time to jump to once the file has loaded */
  want: number | null;
}

interface Sound {
  src: AudioBufferSourceNode;
  gain: GainNode;
  key: string;
}

/**
 * Preview player for a multi-lane timeline. A clock drives the timeline. A small pool of hidden
 * <video> elements decodes the clips that are playing (or about to); each frame the active clips are
 * painted on one canvas, lowest lane first. Sound does not come from the video elements: the sound
 * of every clip is rendered once (with the speed applied, like the export does) and played through
 * Web Audio, so it is mixed, has a working volume on iPhone, and does not depend on how well the
 * browser plays a video at an odd speed.
 */
export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private players: Player[] = [];
  private raf = 0;
  private token = 0;
  tl = 0;
  playing = false;
  /** while a finger is moving a picture, this view is drawn instead of the saved one */
  live: { index: number; view: View } | null = null;
  /** views of several strips being moved together by the group box (clip index to view) */
  liveMany: Map<number, View> | null = null;
  /** crop being dragged on screen (not yet saved to the clip) */
  cropLive: { index: number; crop: Crop } | null = null;
  /** while cutting, the whole uncropped picture is drawn faintly behind the cut one */
  ghost = false;
  /** where the position marker was when play was pressed (for the "return" end mode) */
  private playFrom = 0;

  private clockT0 = 0;
  private clockTl0 = 0;
  /** a clip shown by the trim bar at a source time, whatever the timeline says */
  private scrub: { index: number; t: number } | null = null;

  private actx: AudioContext | null = null;
  private sounds = new Map<string, Sound>();
  private pending = new Set<string>();

  constructor(private deps: PreviewDeps) {
    for (let i = 0; i < POOL; i++) this.players.push(this.makePlayer());
    const wake = () => this.wakeAudio();
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('touchend', wake, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pause();
        void this.actx?.suspend().catch(() => {});
      } else {
        this.wakeAudio();
        requestAnimationFrame(() => this.draw());
      }
    });
    this.hideFromLockScreen();
  }

  private makePlayer(): Player {
    const v = document.createElement('video');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.muted = true;
    v.preservesPitch = true;
    v.disableRemotePlayback = true;
    v.setAttribute('x-webkit-airplay', 'deny');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
    const p: Player = { video: v, clipId: null, mediaId: null, url: '', ready: false, want: null };
    v.addEventListener('loadeddata', () => {
      p.ready = true;
      if (p.want !== null) {
        try {
          v.currentTime = p.want;
        } catch {
          /* not seekable yet */
        }
        p.want = null;
      }
      if (!this.playing) this.draw();
    });
    v.addEventListener('seeked', () => {
      if (!this.playing) this.draw();
    });
    v.addEventListener('play', () => this.hideFromLockScreen());
    return p;
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
    this.stopSounds();
    for (const p of this.players) {
      p.video.pause();
      p.video.removeAttribute('src');
      p.video.load();
      p.video.remove();
    }
  }

  /** whether the preview loudness follows the volume setting (it always does: sound plays through Web Audio) */
  volumeWorks(): boolean {
    return true;
  }

  /** call from a tap: a Web Audio context only starts after a gesture */
  wakeAudio(): void {
    if (!this.actx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.actx = new Ctx();
      } catch {
        return;
      }
    }
    void this.actx.resume().catch(() => {});
  }

  /** the clip that is on screen on top right now (what a finger on the preview moves) */
  currentIndex(): number {
    const clips = this.deps.getProject().clips;
    const shown = activeAt(clips, this.tl).filter((i) => this.deps.getProject().media[clips[i]!.mediaId]?.kind !== 'audio');
    return shown.length ? shown[shown.length - 1]! : -1;
  }

  // ---------- drawing ----------

  draw(): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const p = this.deps.getProject();
    ctx.fillStyle = p.settings.background || '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const list = new Set(activeAt(p.clips, this.tl));
    if (this.scrub) list.add(this.scrub.index);
    const order = [...list].sort((a, b) => (p.clips[a]?.track ?? 0) - (p.clips[b]?.track ?? 0) || a - b);
    for (const i of order) {
      const clip = p.clips[i];
      const media = clip && p.media[clip.mediaId];
      if (!clip || !media || media.kind === 'audio') continue;
      const o = { outW: canvas.width, outH: canvas.height, view: this.liveMany?.get(i) ?? (this.live && this.live.index === i ? this.live.view : clip.view), keepBackground: true };
      // effects are off while a picture is being moved, turned or cropped, and come back on release
      const look = { opacity: clip.opacity, grade: clip.grade, fx: this.live || this.liveMany || this.cropLive ? undefined : clip.fx, crop: this.cropLive && this.cropLive.index === i ? this.cropLive.crop : clip.crop };
      const faint = this.ghost && this.cropLive?.index === i ? { ...look, crop: undefined, opacity: (look.opacity ?? 1) * 0.35 } : null;
      const img = this.deps.getImage(clip.mediaId);
      if (img) {
        if (faint) drawLayer(ctx, img, img.width, img.height, faint, o);
        drawLayer(ctx, img, img.width, img.height, look, o);
        continue;
      }
      const pl = this.players.find((x) => x.clipId === clip.id);
      const v = pl?.video;
      if (pl && v && pl.ready && v.readyState >= 2 && v.videoWidth) {
        if (faint) drawLayer(ctx, v, v.videoWidth, v.videoHeight, faint, o);
        drawLayer(ctx, v, v.videoWidth, v.videoHeight, look, o);
      }
    }
  }

  // ---------- the pool of video elements ----------

  /** gives the clip a video element (loading its file if needed). Returns null when every element is busy. */
  private assign(clip: Clip, keep: Set<string>): Player | null {
    let pl = this.players.find((x) => x.clipId === clip.id);
    if (!pl) {
      pl = this.players.find((x) => x.clipId === null) ?? this.players.find((x) => x.clipId !== null && !keep.has(x.clipId));
      if (!pl) return null;
      pl.video.pause();
      pl.clipId = clip.id;
      pl.mediaId = null;
      pl.url = '';
      pl.ready = false;
    }
    const url = this.deps.getUrl(clip.mediaId) ?? '';
    // a new preview copy appeared: swap files only while the element is not showing the clip live
    if (pl.mediaId !== clip.mediaId || (pl.url !== url && !this.playing)) {
      pl.mediaId = clip.mediaId;
      pl.url = url;
      pl.ready = false;
      pl.want = clip.start;
      pl.video.src = url;
      pl.video.load();
    }
    return pl;
  }

  private release(pl: Player): void {
    pl.video.pause();
    pl.clipId = null;
    pl.mediaId = null;
    pl.ready = false;
    pl.want = null;
  }

  private seekPlayer(pl: Player, time: number): Promise<void> {
    const v = pl.video;
    return new Promise((resolve) => {
      if (!pl.ready) {
        pl.want = time;
        const t = window.setTimeout(resolve, 2500);
        const on = () => {
          clearTimeout(t);
          v.removeEventListener('seeked', on);
          resolve();
        };
        v.addEventListener('seeked', on);
        return;
      }
      if (Math.abs(v.currentTime - time) < 0.002 && v.readyState >= 2) return resolve();
      const t = window.setTimeout(resolve, 1500);
      const on = () => {
        clearTimeout(t);
        v.removeEventListener('seeked', on);
        resolve();
      };
      v.addEventListener('seeked', on);
      try {
        v.currentTime = time;
      } catch {
        resolve();
      }
    });
  }

  private isVideo(clip: Clip): boolean {
    const m = this.deps.getProject().media[clip.mediaId];
    return !!m && m.kind !== 'image' && m.kind !== 'audio';
  }

  /** makes the pool match the timeline at time t: playing clips (and the ones about to start) have an element */
  private sync(t: number, running: boolean): void {
    const clips = this.deps.getProject().clips;
    const active = activeAt(clips, t).filter((i) => this.isVideo(clips[i]!));
    const soon = clips
      .map((c, i) => i)
      .filter((i) => this.isVideo(clips[i]!) && clips[i]!.at > t && clips[i]!.at - t <= LOOKAHEAD && !active.includes(i));
    const wanted = [...active.slice().reverse(), ...soon]; // top lanes first when the pool is short
    const keep = new Set(wanted.map((i) => clips[i]!.id));
    if (this.scrub && clips[this.scrub.index]) keep.add(clips[this.scrub.index]!.id);
    for (const pl of this.players) if (pl.clipId && !keep.has(pl.clipId)) this.release(pl);
    for (const i of wanted.slice(0, POOL)) {
      const clip = clips[i]!;
      const pl = this.assign(clip, keep);
      if (!pl) continue;
      const v = pl.video;
      const isActive = active.includes(i);
      if (!isActive) {
        // waiting for its turn: parked on its first frame
        if (!v.paused) v.pause();
        continue;
      }
      const wantT = sourceAt(clip, t);
      const own = !this.bakeable(clip);
      v.muted = !own || clip.volume <= 0;
      if (own) v.volume = Math.max(0, Math.min(1, clip.volume));
      if (Math.abs(v.playbackRate - clip.speed) > 1e-3) {
        v.playbackRate = clip.speed;
        v.defaultPlaybackRate = clip.speed;
      }
      v.preservesPitch = clip.keepPitch;
      (v as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = clip.keepPitch;
      if (!pl.ready) {
        pl.want = wantT;
        continue;
      }
      if (running) {
        if (Math.abs(v.currentTime - wantT) > DRIFT && !v.seeking) {
          try {
            v.currentTime = wantT;
          } catch {
            /* ignore */
          }
        }
        if (v.paused) void v.play().catch(() => {});
      } else if (!v.paused) v.pause();
    }
  }

  // ---------- sound ----------

  private bakeable(clip: Clip): boolean {
    const media = this.deps.getProject().media[clip.mediaId];
    return !!media?.hasAudio && !!this.deps.getBlob(clip.mediaId) && clip.end - clip.start <= BAKE_MAX_SECONDS;
  }

  private stopSounds(): void {
    for (const s of this.sounds.values()) {
      try {
        s.src.stop();
      } catch {
        /* already stopped */
      }
      s.src.disconnect();
      s.gain.disconnect();
    }
    this.sounds.clear();
    this.pending.clear();
  }

  /** starts, updates or stops the sound of every clip for the current timeline time */
  private syncSounds(t: number, token: number): void {
    const clips = this.deps.getProject().clips;
    const active = new Set(activeAt(clips, t).map((i) => clips[i]!.id));
    for (const [id, s] of this.sounds) {
      const c = clips.find((x) => x.id === id);
      if (!c || !active.has(id) || s.key !== keyOf(c)) {
        try {
          s.src.stop();
        } catch {
          /* already stopped */
        }
        s.src.disconnect();
        s.gain.disconnect();
        this.sounds.delete(id);
      } else s.gain.gain.value = c.volume;
    }
    const actx = this.actx;
    if (!actx) return;
    const startFor = (c: Clip) => {
      if (!this.bakeable(c) || this.sounds.has(c.id) || this.pending.has(c.id) || c.volume <= 0) return;
      const blob = this.deps.getBlob(c.mediaId)!;
      const key = keyOf(c);
      this.pending.add(c.id);
      void bakedAudio(blob, c).then((buf) => {
        this.pending.delete(c.id);
        if (token !== this.token || !this.playing || !buf) return;
        const now = this.deps.getProject().clips.find((x) => x.id === c.id);
        if (!now || keyOf(now) !== key) return;
        if (this.tl < now.at || this.tl >= clipEnd(now) || this.sounds.has(c.id)) return;
        const src = actx.createBufferSource();
        const gain = actx.createGain();
        gain.gain.value = now.volume;
        src.buffer = buf;
        src.connect(gain).connect(actx.destination);
        const offset = this.tl - now.at;
        if (offset < buf.duration) src.start(0, offset);
        this.sounds.set(c.id, { src, gain, key });
      });
    };
    for (const i of activeAt(clips, t)) startFor(clips[i]!);
    // sounds that start soon are rendered ahead of time
    for (const c of clips) if (c.at > t && c.at - t < 6) void (this.bakeable(c) && c.volume > 0 && bakedAudio(this.deps.getBlob(c.mediaId)!, c));
  }

  // ---------- transport ----------

  private stopPlaying(): void {
    this.stopSounds();
    if (this.playing) {
      this.playing = false;
      for (const pl of this.players) pl.video.pause();
      this.deps.onPlaying(false);
    }
  }

  pause(): void {
    this.token++;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
  }

  /** Pause and show the frame at timeline time t. */
  async showAt(t: number): Promise<void> {
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    this.stopPlaying();
    this.scrub = null;
    const clips = this.deps.getProject().clips;
    this.tl = Math.max(0, Math.min(t, totalOf(clips)));
    this.sync(this.tl, false);
    const seeks: Promise<void>[] = [];
    for (const i of activeAt(clips, this.tl)) {
      const clip = clips[i]!;
      const pl = this.players.find((x) => x.clipId === clip.id);
      if (pl && this.isVideo(clip)) seeks.push(this.seekPlayer(pl, sourceAt(clip, this.tl)));
    }
    this.draw();
    await Promise.all(seeks);
    if (tok !== this.token) return;
    this.draw();
    this.deps.onTime(this.tl);
  }

  async play(): Promise<void> {
    this.wakeAudio();
    const clips = this.deps.getProject().clips;
    if (clips.length === 0) return;
    const total = totalOf(clips);
    if (this.tl >= total - 0.05) this.tl = 0;
    this.playFrom = this.tl;
    await this.showAt(this.tl);
    const tok = ++this.token;
    this.playing = true;
    this.deps.onPlaying(true);
    this.clockT0 = performance.now();
    this.clockTl0 = this.tl;
    this.loop(tok);
  }

  private loop(tok: number): void {
    this.raf = requestAnimationFrame(() => this.step(tok));
  }

  private step(tok: number): void {
    if (tok !== this.token || !this.playing) return;
    const total = totalOf(this.deps.getProject().clips);
    const tl = this.clockTl0 + (performance.now() - this.clockT0) / 1000;
    if (tl >= total) {
      const mode = this.deps.getEnd();
      this.tl = mode === 'pause' ? total : mode === 'return' ? Math.min(this.playFrom, total) : 0;
      this.stopPlaying();
      if (mode === 'pause') {
        this.draw();
        this.deps.onTime(this.tl);
      } else if (mode === 'loop') void this.play();
      else void this.showAt(this.tl);
      return;
    }
    this.tl = tl;
    this.sync(tl, true);
    this.syncSounds(tl, tok);
    this.draw();
    this.deps.onTime(tl);
    this.loop(tok);
  }

  // ---------- scrubbing by source time (trim handles and the trim bar) ----------

  private scrubTarget: { index: number; t: number; report: boolean } | null = null;
  private scrubbing = false;

  /**
   * Shows the frame at `srcT` (seconds in the source file) of clip `index`, without touching the
   * project. Rapid calls are merged: only the newest target is ever seeked to.
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
        const clips = this.deps.getProject().clips;
        const clip = clips[tg.index];
        if (!clip) continue;
        this.scrub = { index: tg.index, t: tg.t };
        if (this.isVideo(clip)) {
          const keep = new Set(activeAt(clips, this.tl).map((i) => clips[i]!.id));
          keep.add(clip.id);
          const pl = this.assign(clip, keep);
          if (pl) await this.seekPlayer(pl, Math.max(0, tg.t));
        }
        this.draw();
        if (tg.report) {
          this.tl = Math.min(totalOf(clips), clip.at + Math.max(0, (tg.t - clip.start) / clip.speed));
          this.deps.onTime(this.tl);
        }
      }
    } finally {
      this.scrubbing = false;
    }
  }
}
