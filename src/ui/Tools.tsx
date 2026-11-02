import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { pickVideos } from '../files.ts';
import {
  deleteClip,
  duplicateClip,
  getState,
  moveClip,
  rotateClip,
  set,
  setCropAspect,
  setSpeed,
  setTrim,
  splitAtPlayhead,
  toast,
  updateClip,
  useStore,
  type Tool,
} from '../store.ts';
import { MAX_SPEED, MIN_CLIP, MIN_SPEED, clipDuration, fmtTime, layout, locate } from '../timeline.ts';
import { Clips, Crop, Left, Copy, Mute, Plus, Right, Rotate, RotateL, Sound, Speed, Split, Trash, Trim } from './icons.tsx';

const TABS: { id: Tool; label: string; icon: () => JSX.Element }[] = [
  { id: 'trim', label: 'Trim', icon: Trim },
  { id: 'speed', label: 'Speed', icon: Speed },
  { id: 'rotate', label: 'Rotate', icon: Rotate },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'sound', label: 'Sound', icon: Sound },
  { id: 'clip', label: 'Clip', icon: Clips },
];

export function Tools() {
  const tool = useStore((s) => s.tool);
  return (
    <div class="tools">
      <div class="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} class={tool === t.id ? 'on' : ''} onClick={() => set({ tool: t.id })}>
            <t.icon />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="panel">
        {tool === 'trim' && <TrimPanel />}
        {tool === 'speed' && <SpeedPanel />}
        {tool === 'rotate' && <RotatePanel />}
        {tool === 'crop' && <CropPanel />}
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

function TrimPanel() {
  const { project, index, clip, media } = useSel();
  const playhead = useStore((s) => s.playhead);
  const track = useRef<HTMLDivElement>(null);
  const [fine, setFine] = useState(false);
  const drag = useRef<{
    mode: 'start' | 'end' | 'seek';
    id: number;
    x0: number;
    moved: boolean;
    /** handle time minus finger time at grab, so the handle does not jump under the finger */
    offset: number;
    /** fine mode anchor */
    anchorX: number;
    anchorT: number;
    fine: boolean;
    timer: number;
  } | null>(null);
  if (!clip || !media) return null;

  const L = layout(project.clips);
  const rect = () => track.current!.getBoundingClientRect();
  const timeAt = (clientX: number) => {
    const r = rect();
    return Math.min(media.duration, Math.max(0, ((clientX - r.left) / r.width) * media.duration));
  };
  const apply = (which: 'start' | 'end', t: number) => {
    const c = clipAt(index);
    if (!c) return;
    if (which === 'start') setTrim(index, Math.min(t, c.end - MIN_CLIP), c.end);
    else setTrim(index, c.start, Math.max(t, c.start + MIN_CLIP));
    const now = clipAt(index)!;
    const start = layout(getState().project.clips).starts[index]!;
    void engine.showAt(which === 'start' ? start : start + Math.max(0, clipDuration(now) - 0.05)).then(() => set({ playhead: engine.tl }));
  };
  /** show the frame at a source time inside the kept part of this clip */
  const seekSource = (srcT: number) => {
    const c = clipAt(index);
    if (!c) return;
    const t = Math.min(c.end, Math.max(c.start, srcT));
    const start = layout(getState().project.clips).starts[index]!;
    const tl = start + Math.min(clipDuration(c), (t - c.start) / c.speed);
    set({ playhead: tl });
    void engine.showAt(tl);
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    engine.pause();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = rect();
    const xStart = r.left + (clip.start / media.duration) * r.width;
    const xEnd = r.left + (clip.end / media.duration) * r.width;
    const dS = Math.abs(e.clientX - xStart);
    const dE = Math.abs(e.clientX - xEnd);
    let mode: 'start' | 'end' | 'seek' = 'seek';
    // the start handle hangs off the left of its edge, the end handle off the right: grab zones follow that
    if (Math.min(dS, dE) <= HIT) mode = dS < dE || (dS === dE && e.clientX < (xStart + xEnd) / 2) ? 'start' : 'end';
    const d = {
      mode,
      id: e.pointerId,
      x0: e.clientX,
      moved: false,
      offset: mode === 'seek' ? 0 : (mode === 'start' ? clip.start : clip.end) - timeAt(e.clientX),
      anchorX: e.clientX,
      anchorT: mode === 'start' ? clip.start : clip.end,
      fine: false,
      timer: 0,
    };
    drag.current = d;
    if (mode === 'seek') {
      seekSource(timeAt(e.clientX));
    } else {
      d.timer = window.setTimeout(() => {
        if (drag.current !== d || d.moved) return;
        d.fine = true;
        d.anchorX = d.x0;
        d.anchorT = mode === 'start' ? clipAt(index)!.start : clipAt(index)!.end;
        setFine(true);
        try {
          navigator.vibrate?.(8);
        } catch {
          /* not supported */
        }
      }, HOLD_MS);
    }
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.fine && Math.abs(e.clientX - d.x0) > 6) {
      d.moved = true;
      clearTimeout(d.timer);
    }
    if (d.mode === 'seek') return seekSource(timeAt(e.clientX));
    if (d.fine) {
      const r = rect();
      apply(d.mode, Math.min(media.duration, Math.max(0, d.anchorT + ((e.clientX - d.anchorX) / r.width) * media.duration * FINE)));
    } else if (d.moved) {
      apply(d.mode, timeAt(e.clientX) + d.offset);
    }
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    clearTimeout(d.timer);
    drag.current = null;
    setFine(false);
  };

  const pct = (t: number) => `${(t / media.duration) * 100}%`;
  const at = locate(L, playhead);
  const srcNow = at && at.index === index ? clip.start + at.local * clip.speed : null;

  const setHere = (which: 'start' | 'end') => {
    if (srcNow === null) return toast('Move the position marker onto this clip first.');
    apply(which, srcNow);
  };
  const split = () => {
    if (!splitAtPlayhead()) toast('Move the marker into the clip, away from its edges, to cut here.');
  };

  return (
    <>
      <div class={`trim ${fine ? 'fine' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div class="trim-track" ref={track}>
          <div class="trim-bar" />
          <div class="trim-keep" style={{ left: pct(clip.start), width: pct(clip.end - clip.start) }} />
          {srcNow !== null && <div class="trim-now" style={{ left: pct(srcNow) }} />}
          <div class="trim-grip" style={{ left: pct(clip.start) }} />
          <div class="trim-grip end" style={{ left: pct(clip.end) }} />
        </div>
      </div>
      <p class="hint trim-hint">{fine ? 'Fine control: slide to adjust slowly.' : 'Drag the bar to look around. Hold a yellow end still, then slide, for fine control.'}</p>
      <div class="readout num">
        <span>{fmtTime(clip.start, 2)}</span>
        <span class="mid">{fmtTime(clip.end - clip.start, 2)} kept</span>
        <span>{fmtTime(clip.end, 2)}</span>
      </div>
      <div class="row">
        <button class="btn" onClick={() => setHere('start')}>
          Start here
        </button>
        <button class="btn" onClick={() => setHere('end')}>
          End here
        </button>
        <button class="btn" onClick={split}>
          <Split /> Cut here
        </button>
      </div>
    </>
  );
}

const clipAt = (i: number) => getState().project.clips[i];

// ---------- speed ----------

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

function SpeedPanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  return (
    <>
      <div class="chips">
        {SPEEDS.map((s) => (
          <button key={s} class={`chip num ${clip.speed === s ? 'on' : ''}`} onClick={() => setSpeed(index, s)}>
            {s}×
          </button>
        ))}
      </div>
      <input class="slider" type="range" min={MIN_SPEED} max={MAX_SPEED} step={0.05} value={clip.speed} onInput={(e) => setSpeed(index, Number((e.currentTarget as HTMLInputElement).value))} aria-label="Speed" />
      <div class="readout num">
        <span>{clip.speed.toFixed(2)}×</span>
        <span class="mid">plays for {fmtTime(clipDuration(clip))}</span>
      </div>
      <div class="chips" role="group" aria-label="Pitch">
        <button class={`chip ${clip.keepPitch ? 'on' : ''}`} aria-pressed={clip.keepPitch} onClick={() => updateClip(index, { keepPitch: true })}>
          Keep voice pitch
        </button>
        <button class={`chip ${!clip.keepPitch ? 'on' : ''}`} aria-pressed={!clip.keepPitch} onClick={() => updateClip(index, { keepPitch: false })}>
          Pitch follows speed
        </button>
      </div>
    </>
  );
}

// ---------- rotate ----------

function RotatePanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  return (
    <>
      <div class="row big">
        <button class="btn" onClick={() => rotateClip(index, 'ccw')}>
          <RotateL /> Left
        </button>
        <button class="btn" onClick={() => rotateClip(index, 'cw')}>
          <Rotate /> Right
        </button>
      </div>
      <div class="readout num">
        <span class="mid">{clip.rotation}° turned</span>
      </div>
    </>
  );
}

// ---------- crop ----------

const ASPECTS: { label: string; value: number }[] = [
  { label: '9:16', value: 9 / 16 },
  { label: '4:5', value: 4 / 5 },
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
];

function CropPanel() {
  const { index, clip } = useSel();
  if (!clip) return null;
  const free = clip.cropAspect === null;
  return (
    <>
      <div class="chips">
        <button class={`chip ${free && clip.crop ? 'on' : ''}`} onClick={() => setCropAspect(index, null)}>
          Free
        </button>
        {ASPECTS.map((a) => (
          <button key={a.label} class={`chip num ${clip.cropAspect !== null && Math.abs(clip.cropAspect - a.value) < 1e-3 ? 'on' : ''}`} onClick={() => setCropAspect(index, a.value)}>
            {a.label}
          </button>
        ))}
        <button class="chip" onClick={() => updateClip(index, { crop: null, cropAspect: null })}>
          Reset
        </button>
      </div>
      <p class="hint">Drag the box or its corners on the picture.</p>
      <div class="chips" role="group" aria-label="Picture fit">
        <button class={`chip ${clip.fit === 'contain' ? 'on' : ''}`} aria-pressed={clip.fit === 'contain'} onClick={() => updateClip(index, { fit: 'contain' })}>
          Fit (bars)
        </button>
        <button class={`chip ${clip.fit === 'cover' ? 'on' : ''}`} aria-pressed={clip.fit === 'cover'} onClick={() => updateClip(index, { fit: 'cover' })}>
          Fill (trim edges)
        </button>
      </div>
      <p class="hint">Only matters when this clip's shape differs from the export shape. Applies to this clip.</p>
    </>
  );
}

// ---------- sound ----------

function SoundPanel() {
  const { index, clip, media } = useSel();
  if (!clip || !media) return null;
  if (!media.hasAudio) return <p class="hint">This video has no sound.</p>;
  return (
    <div class="row big">
      <button class={`btn ${clip.muted ? 'on' : ''}`} onClick={() => updateClip(index, { muted: !clip.muted })} aria-pressed={clip.muted}>
        {clip.muted ? <Mute /> : <Sound />} {clip.muted ? 'Muted' : 'Sound on'}
      </button>
    </div>
  );
}

// ---------- clip ----------

function ClipPanel() {
  const { project, index } = useSel();
  const last = project.clips.length - 1;
  return (
    <div class="grid2">
      <button class="btn" disabled={index <= 0} onClick={() => moveClip(index, -1)}>
        <Left /> Earlier
      </button>
      <button class="btn" disabled={index >= last} onClick={() => moveClip(index, 1)}>
        Later <Right />
      </button>
      <button class="btn" onClick={() => duplicateClip(index)}>
        <Copy /> Duplicate
      </button>
      <button class="btn danger" onClick={() => deleteClip(index)}>
        <Trash /> Remove
      </button>
      <button class="btn wide" onClick={pickVideos}>
        <Plus /> Add videos
      </button>
    </div>
  );
}
