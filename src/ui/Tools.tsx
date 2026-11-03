import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { deleteClip, duplicateClip, getState, set, splitAtPlayhead, toast, setSpeed, setTrim, updateClip, useStore, type Tool } from '../store.ts';
import { MAX_SPEED, MIN_CLIP, MIN_SPEED, clipDuration, clipEnd, fmtTime } from '../timeline.ts';
import { IMAGE_MAX_SECONDS } from '../media.ts';
import { Clips, Copy, Mute, Sound, Speed, Split, Trash, Trim } from './icons.tsx';
import { Slider } from './Slider.tsx';

const TABS: { id: Tool; label: string; icon: () => JSX.Element }[] = [
  { id: 'trim', label: 'Trim', icon: Trim },
  { id: 'speed', label: 'Speed', icon: Speed },
  { id: 'sound', label: 'Sound', icon: Sound },
  { id: 'clip', label: 'Clip', icon: Clips },
];

export function Tools() {
  const stored = useStore((s) => s.tool);
  const kind = useStore((s) => {
    const c = s.project.clips[s.selected];
    const m = c && s.project.media[c.mediaId];
    return !m ? 'none' : m.kind === 'image' ? 'image' : m.hasAudio ? 'video' : 'silent';
  });
  // a picture only has a duration; a video without sound has no Sound tab
  const tabs = kind === 'image' ? [{ id: 'trim' as Tool, label: 'Duration', icon: Trim }, { id: 'clip' as Tool, label: 'Clip', icon: Clips }] : kind === 'silent' ? TABS.filter((t) => t.id !== 'sound') : TABS;
  const tool = tabs.some((t) => t.id === stored) ? stored : 'trim';
  return (
    <div class="tools">
      <div class="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} class={tool === t.id ? 'on' : ''} onClick={() => set({ tool: t.id })}>
            <t.icon />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="panel">
        {tool === 'trim' && (kind === 'image' ? <DurationPanel /> : <TrimPanel />)}
        {tool === 'speed' && <SpeedPanel />}
        {tool === 'sound' && <SoundPanel />}
        {tool === 'clip' && <ClipPanel />}
      </div>
    </div>
  );
}

function useSel() {
  const project = useStore((s) => s.project);
  const index = useStore((s) => s.selected);
  const clip = project.clips[index];
  return { project, index, clip, media: clip ? project.media[clip.mediaId] : undefined };
}

// ---------- trim ----------

const HIT = 26; // px: how close a finger must be to a handle to grab it
const HOLD_MS = 450; // hold a handle still this long for fine control (like the iPhone Photos trimmer)
const FINE = 0.1; // in fine mode the handle moves a tenth as far as the finger
const JITTER = 10; // px a finger may wobble while "holding still"

function TrimPanel() {
  const { project, index, clip, media } = useSel();
  const playhead = useStore((s) => s.playhead);
  const track = useRef<HTMLDivElement>(null);
  const els = useRef<Record<'keep' | 'gs' | 'ge' | 'rs' | 'rm' | 're', HTMLElement | null>>({ keep: null, gs: null, ge: null, rs: null, rm: null, re: null });
  const [fine, setFine] = useState<'start' | 'end' | 'seek' | null>(null);
  const drag = useRef<{
    mode: 'start' | 'end' | 'seek';
    id: number;
    moved: boolean;
    /** handle time minus finger time at grab, so the handle does not jump under the finger */
    offset: number;
    anchorX: number;
    anchorT: number;
    last: number;
    armX: number;
    seekT: number;
    fine: boolean;
    timer: number;
    /** the trim while dragging; only saved when the finger lifts */
    s: number;
    e: number;
  } | null>(null);
  if (!clip || !media) return null;

  const rect = () => track.current!.getBoundingClientRect();
  const timeAt = (clientX: number) => {
    const r = rect();
    return Math.min(media.duration, Math.max(0, ((clientX - r.left) / r.width) * media.duration));
  };

  /** moves the bar, handles and numbers directly in the page: no re-render while a finger is down */
  const paint = (s: number, e: number) => {
    const x = els.current;
    const pc = (t: number) => `${(t / media.duration) * 100}%`;
    if (x.keep) (x.keep.style.left = pc(s)), (x.keep.style.width = pc(e - s));
    if (x.gs) x.gs.style.left = pc(s);
    if (x.ge) x.ge.style.left = pc(e);
    if (x.rs) x.rs.textContent = fmtTime(s, 2);
    if (x.re) x.re.textContent = fmtTime(e, 2);
    if (x.rm) x.rm.textContent = `${fmtTime((e - s) / clip.speed, 2)} kept`;
  };
  const moveHandle = (d: NonNullable<typeof drag.current>, t: number) => {
    if (d.mode === 'start') d.s = Math.max(0, Math.min(t, d.e - MIN_CLIP));
    else d.e = Math.min(media.duration, Math.max(t, d.s + MIN_CLIP));
    paint(d.s, d.e);
    engine.scrubSource(index, d.mode === 'start' ? d.s : Math.max(d.s, d.e - 0.05), false);
  };
  const seekAt = (clientX: number) => {
    const c = clipAt(index);
    if (!c) return;
    engine.scrubSource(index, Math.min(c.end - 0.001, Math.max(c.start, timeAt(clientX))), true);
  };
  const seekTo = (d: NonNullable<typeof drag.current>, t: number) => {
    const c = clipAt(index);
    if (!c) return;
    d.seekT = t;
    engine.scrubSource(index, Math.min(c.end - 0.001, Math.max(c.start, t)), true);
  };
  /** after a handle is released: save the trim and show the clip's edge */
  const commit = (d: NonNullable<typeof drag.current>) => {
    setTrim(index, d.s, d.e);
    const now = clipAt(index)!;
    const start = now.at;
    void engine.showAt(d.mode === 'start' ? start : start + Math.max(0, clipDuration(now) - 0.05)).then(() => set({ playhead: engine.tl }));
  };
  /** (re)starts the hold timer: when the finger stays still this long, fine control begins right there */
  const arm = (d: NonNullable<typeof drag.current>) => {
    clearTimeout(d.timer);
    d.timer = window.setTimeout(() => {
      if (drag.current !== d || d.fine) return;
      d.fine = true;
      d.anchorX = d.last;
      d.anchorT = d.mode === 'start' ? d.s : d.mode === 'end' ? d.e : d.seekT;
      setFine(d.mode);
      try {
        navigator.vibrate?.(8);
      } catch {
        /* not supported (iPhone) */
      }
    }, HOLD_MS);
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    engine.pause();
    if (drag.current) clearTimeout(drag.current.timer); // a stale drag (lost finger) is dropped
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = rect();
    const xStart = r.left + (clip.start / media.duration) * r.width;
    const xEnd = r.left + (clip.end / media.duration) * r.width;
    const dS = Math.abs(e.clientX - xStart);
    const dE = Math.abs(e.clientX - xEnd);
    let mode: 'start' | 'end' | 'seek' = 'seek';
    if (Math.min(dS, dE) <= HIT) mode = dS < dE || (dS === dE && e.clientX < (xStart + xEnd) / 2) ? 'start' : 'end';
    const d = {
      mode,
      id: e.pointerId,
      last: e.clientX,
      armX: e.clientX,
      moved: false,
      offset: mode === 'seek' ? 0 : (mode === 'start' ? clip.start : clip.end) - timeAt(e.clientX),
      anchorX: e.clientX,
      anchorT: mode === 'start' ? clip.start : clip.end,
      seekT: timeAt(e.clientX),
      fine: false,
      timer: 0,
      s: clip.start,
      e: clip.end,
    };
    drag.current = d;
    if (mode === 'seek') seekAt(e.clientX);
    arm(d);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.last = e.clientX;
    const r = rect();
    if (d.fine) {
      const t = Math.min(media.duration, Math.max(0, d.anchorT + ((e.clientX - d.anchorX) / r.width) * media.duration * FINE));
      if (d.mode === 'seek') return seekTo(d, t);
      return moveHandle(d, t);
    }
    // moving restarts the hold timer, so holding still anywhere along the way gives fine control
    if (Math.abs(e.clientX - d.armX) > JITTER) {
      d.armX = e.clientX;
      d.moved = true;
      arm(d);
    }
    if (d.mode === 'seek') return seekTo(d, timeAt(e.clientX));
    if (d.moved) moveHandle(d, timeAt(e.clientX) + d.offset);
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    clearTimeout(d.timer);
    drag.current = null;
    setFine(null);
    if (d.mode !== 'seek' && (d.s !== clip.start || d.e !== clip.end)) commit(d);
  };

  const pct = (t: number) => `${(t / media.duration) * 100}%`;
  const srcNow = playhead >= clip.at && playhead < clipEnd(clip) ? clip.start + (playhead - clip.at) * clip.speed : null;

  return (
    <>
      <div class={`trim ${fine ? `fine fine-${fine}` : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div class="trim-track" ref={track}>
          <div class="trim-bar" />
          <div class="trim-keep" ref={(n) => void (els.current.keep = n)} style={{ left: pct(clip.start), width: pct(clip.end - clip.start) }} />
          {srcNow !== null && <div class="trim-now" style={{ left: pct(srcNow) }} />}
          <div class="trim-grip" ref={(n) => void (els.current.gs = n)} style={{ left: pct(clip.start) }} />
          <div class="trim-grip end" ref={(n) => void (els.current.ge = n)} style={{ left: pct(clip.end) }} />
          {fine && <div class="trim-fine-label">FINE · slide slowly</div>}
        </div>
      </div>
      <div class="readout num">
        <span ref={(n) => void (els.current.rs = n)}>{fmtTime(clip.start, 2)}</span>
        <span class="mid" ref={(n) => void (els.current.rm = n)}>
          {fmtTime(clipDuration(clip), 2)} kept
        </span>
        <span ref={(n) => void (els.current.re = n)}>{fmtTime(clip.end, 2)}</span>
      </div>
    </>
  );
}

const clipAt = (i: number) => getState().project.clips[i];

// ---------- duration (pictures) ----------

const DURATIONS = [1, 2, 3, 5, 7, 10, 15, 20, 30];

function DurationPanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  const d = clip.end - clip.start;
  return (
    <>
      <Slider label="Duration" value={d} min={0.5} max={IMAGE_MAX_SECONDS} step={0.5} fineStep={0.1} snaps={DURATIONS} snapPx={10} valueText={`${d.toFixed(1)} seconds`} onChange={(v) => updateClip(index, { start: 0, end: Math.min(IMAGE_MAX_SECONDS, v) })} />
      <div class="readout num">
        <span class="mid">{d.toFixed(d % 1 ? 1 : 0)} seconds</span>
      </div>
    </>
  );
}

// ---------- speed ----------

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function SpeedPanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  return (
    <>
      <Slider label="Speed" value={clip.speed} min={MIN_SPEED} max={MAX_SPEED} log snaps={SPEEDS} snapPx={12} step={0.05} fineStep={0.01} valueText={`${clip.speed} times`} onChange={(v) => setSpeed(index, v)} />
      <div class="readout num">
        <span>{clip.speed.toFixed(2).replace(/0$/, '')}×</span>
        <span class="mid">plays for {fmtTime(clipDuration(clip))}</span>
        <button class="pitch" onClick={() => updateClip(index, { keepPitch: !clip.keepPitch })}>
          {clip.keepPitch ? 'Pitch kept' : 'Pitch follows speed'}
        </button>
      </div>
    </>
  );
}

// ---------- sound ----------

/** the loudness each clip had before it was muted, so tapping the speaker brings it back */
const before = new Map<string, number>();

function SoundPanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  const pct = Math.round(clip.volume * 100);
  const set = (v: number) => updateClip(index, { volume: Math.min(1, Math.max(0, v / 100)) });
  const toggle = () => {
    if (clip.volume > 0) {
      before.set(clip.id, clip.volume);
      updateClip(index, { volume: 0 });
    } else {
      updateClip(index, { volume: before.get(clip.id) ?? 1 });
    }
  };
  return (
    <div class="sound">
      <button class={`speaker ${pct === 0 ? 'muted' : ''}`} onClick={toggle} aria-label={pct === 0 ? 'Unmute' : 'Mute'} aria-pressed={pct === 0}>
        {pct === 0 ? <Mute /> : <Sound />}
      </button>
      <Slider label="Volume" value={pct} min={0} max={100} step={1} fineStep={0.5} snaps={[0, 100]} snapPx={14} valueText={pct === 0 ? 'muted' : `${pct} percent`} onChange={set} />
      <span class="num vol">{pct === 0 ? 'Muted' : `${pct}%`}</span>
      {!engine.volumeWorks() && <p class="hint volume-note">This browser can't turn the preview down, so you will hear it at full volume here. The exported video does use this volume.</p>}
    </div>
  );
}

// ---------- clip ----------

function ClipPanel() {
  const { index, media } = useSel();
  const image = media?.kind === 'image';
  return (
    <div class="clip-row">
      {!image && (
        <button class="btn" onClick={() => !splitAtPlayhead() && toast('Move the position marker into this clip, away from its edges, to cut there.')}>
          <Split /> Split here
        </button>
      )}
      <button class="btn" onClick={() => duplicateClip(index)}>
        <Copy /> Duplicate
      </button>
      <button class="btn danger" onClick={() => deleteClip(index)}>
        <Trash /> Delete clip
      </button>
    </div>
  );
}
