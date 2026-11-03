import { useEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { thumbUrl } from '../media.ts';
import { moveClipTo, selectClip, set, useStore } from '../store.ts';
import { clipDuration, clipEnd, fmtTime, totalOf } from '../timeline.ts';
import type { Clip, MediaInfo } from '../types.ts';
import { PickLabel } from './Picker.tsx';
import { Pie } from './Pie.tsx';
import { Plus } from './icons.tsx';

const HOLD_MS = 350; // hold a strip this long (without moving) to pick it up
const WOBBLE = 10;
const EDGE = 44; // px from the edge of the timeline where dragging starts to scroll it
const ROW = 40;
const GAP = 4;
const RULER = 22;
const SNAP_PX = 8;

interface Drag {
  index: number;
  at: number;
  track: number;
}

const isAudio = (m: MediaInfo | undefined) => m?.kind === 'audio';

/** the lane numbers shown, top to bottom: one empty lane above the highest clip, lane 0, and the sound lane(s) */
function lanesFor(clips: Clip[], extra: number | null): number[] {
  let hi = 0;
  let lo = -1;
  for (const c of clips) (hi = Math.max(hi, c.track)), (lo = Math.min(lo, c.track));
  if (extra !== null) (hi = Math.max(hi, extra)), (lo = Math.min(lo, extra));
  const out: number[] = [];
  for (let t = hi + 1; t >= lo; t--) out.push(t);
  return out;
}

/**
 * The timeline: lanes of strips against a time ruler. Lanes higher up are drawn on top of the ones
 * below; sound clips sit on the lanes under lane 0. Tap a strip to select it. Hold a strip until it
 * lifts, then drag it along the time axis or up and down between lanes (it snaps to other clips, the
 * position marker and the start). Drag the ruler to move the position marker.
 */
export function Timeline() {
  const clips = useStore((s) => s.project.clips);
  const media = useStore((s) => s.project.media);
  const selected = useStore((s) => s.selected);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const progress = useStore((s) => s.proxyProgress);
  const [pps, setPps] = useState(36); // pixels per second
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: number; i: number; x0: number; y0: number; x: number; y: number; at0: number; track0: number; scroll0: number; timer: number; active: boolean; moved: boolean; raf: number } | null>(null);
  const swallow = useRef(false);
  const live = useRef({ clips, pps, lanes: [] as number[], playhead });

  const lanes = lanesFor(clips, drag?.track ?? null);
  live.current = { clips, pps, lanes, playhead };
  const total = totalOf(clips);
  const viewW = scroller.current?.clientWidth ?? 360;
  const width = Math.max(total + 8, viewW / pps) * pps + 40;

  // keep the position marker in view while playing
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = playhead * pps;
    if (x < el.scrollLeft + 16 || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.3);
  }, [playhead, playing, pps]);

  // while a strip is picked up the timeline must not scroll under the finger: only a non-passive touchmove can stop that
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (st.current?.active) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  /** time of the nearest snap point to `t` (strip start or end), or t itself */
  const snap = (index: number, at: number, dur: number): number => {
    const { clips: cs, pps: k } = live.current;
    const limit = SNAP_PX / k;
    const points = [0, live.current.playhead];
    cs.forEach((c, i) => {
      if (i !== index) points.push(c.at, clipEnd(c));
    });
    let best = at;
    let d = limit;
    for (const p of points) {
      for (const cand of [p, p - dur]) {
        const dd = Math.abs(at - cand);
        if (dd < d) (d = dd), (best = cand);
      }
    }
    return Math.max(0, best);
  };

  const update = () => {
    const s = st.current;
    const el = scroller.current;
    if (!s || !s.active || !el) return;
    const { clips: cs, pps: k, lanes: ln } = live.current;
    const clip = cs[s.i];
    if (!clip) return;
    const r = el.getBoundingClientRect();
    let v = 0;
    if (s.x < r.left + EDGE) v = -Math.ceil(((r.left + EDGE - s.x) / EDGE) * 14);
    else if (s.x > r.right - EDGE) v = Math.ceil(((s.x - (r.right - EDGE)) / EDGE) * 14);
    if (v) el.scrollLeft += v;
    const raw = s.at0 + (s.x - s.x0 + (el.scrollLeft - s.scroll0)) / k;
    const at = snap(s.i, raw, clipDuration(clip));
    // lanes are listed top to bottom; moving down by a row goes one lane down
    const from = ln.indexOf(s.track0);
    let row = from + Math.round((s.y - s.y0) / (ROW + GAP));
    row = Math.max(0, Math.min(ln.length - 1, row));
    let track = ln[row]!;
    // pictures and videos live on lane 0 and above, sound on the lanes below
    const audio = isAudio(media[clip.mediaId]);
    if (audio && track >= 0) track = -1;
    if (!audio && track < 0) track = 0;
    setDrag({ index: s.i, at, track });
    s.raf = requestAnimationFrame(update);
  };

  const finish = (commit: boolean) => {
    const s = st.current;
    if (!s) return;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    st.current = null;
    if (s.active) {
      swallow.current = true;
      setTimeout(() => (swallow.current = false), 0);
      setDrag((d) => {
        if (commit && d) {
          const c = live.current.clips[d.index];
          if (c && (d.at !== c.at || d.track !== c.track)) moveClipTo(d.index, d.at, d.track);
          // picked up and put back where it was: the person probably wants to do something with the clip
          else if (c) set({ tool: 'clip' });
        }
        return null;
      });
    }
  };

  const down = (i: number) => (e: PointerEvent) => {
    if (st.current) finish(false);
    const el = scroller.current;
    const clip = clips[i];
    if (!el || !clip) return;
    const target = e.currentTarget as HTMLElement;
    const s = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at0: clip.at, track0: clip.track, scroll0: el.scrollLeft, timer: 0, active: false, moved: false, raf: 0 };
    st.current = s;
    s.timer = window.setTimeout(() => {
      s.active = true;
      s.scroll0 = el.scrollLeft;
      s.x0 = s.x;
      s.y0 = s.y;
      engine.pause();
      selectClip(i);
      try {
        target.setPointerCapture(s.id);
      } catch {
        /* the pointer is gone */
      }
      try {
        navigator.vibrate?.(12);
      } catch {
        /* not supported */
      }
      setDrag({ index: i, at: clip.at, track: clip.track });
      s.raf = requestAnimationFrame(update);
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.active && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > WOBBLE) {
      clearTimeout(s.timer); // a scroll, not a pick-up
      st.current = null;
    }
  };
  const up = (e: PointerEvent) => {
    const s = st.current;
    if (s && e.pointerId === s.id) finish(e.type === 'pointerup');
  };

  // ---- the ruler: drag to move the position marker ----
  const scrubbing = useRef(false);
  const seekTo = (clientX: number) => {
    const el = scroller.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(total, (clientX - r.left + el.scrollLeft) / pps));
    set({ playhead: t });
    void engine.showAt(t);
  };

  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 56) ?? 120;
  const ticks: number[] = [];
  for (let t = 0; t <= width / pps; t += step) ticks.push(t);
  const height = RULER + lanes.length * (ROW + GAP) + 4;

  return (
    <div class={`tl ${drag ? 'dragging' : ''}`}>
      <div class="tl-bar">
        <PickLabel class="tl-add" label="Add videos, pictures or sound">
          <Plus /> <span>Add</span>
        </PickLabel>
        <span class="tl-hint" />
        <button class="tl-zoom" aria-label="Zoom out the timeline" onClick={() => setPps((v) => Math.max(8, v / 1.5))}>
          −
        </button>
        <button class="tl-zoom" aria-label="Zoom in the timeline" onClick={() => setPps((v) => Math.min(240, v * 1.5))}>
          +
        </button>
      </div>
      <div class="tl-scroll" ref={scroller}>
        <div class="tl-inner" style={{ width: `${width}px`, height: `${height}px` }}>
          <div
            class="tl-ruler"
            style={{ height: `${RULER}px` }}
            onPointerDown={(e) => {
              scrubbing.current = true;
              engine.pause();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              seekTo(e.clientX);
            }}
            onPointerMove={(e) => scrubbing.current && seekTo(e.clientX)}
            onPointerUp={() => (scrubbing.current = false)}
            onPointerCancel={() => (scrubbing.current = false)}
          >
            {ticks.map((t) => (
              <span key={t} class="tl-tick num" style={{ left: `${t * pps}px` }}>
                {fmtTime(t, 0)}
              </span>
            ))}
          </div>
          {lanes.map((track, row) => (
            <div key={track} class={`tl-lane ${track < 0 ? 'sound' : ''} ${drag?.track === track ? 'target' : ''}`} style={{ top: `${RULER + row * (ROW + GAP)}px`, height: `${ROW}px` }}>
              <span class="tl-lane-name">{track < 0 ? '♪' : `V${track + 1}`}</span>
            </div>
          ))}
          {clips.map((c, i) => {
            const m = media[c.mediaId];
            const dragging = drag?.index === i;
            const at = dragging ? drag!.at : c.at;
            const track = dragging ? drag!.track : c.track;
            const row = lanes.indexOf(track);
            if (row < 0) return null;
            const url = thumbUrl(c.mediaId);
            const p = progress[c.mediaId];
            const audio = isAudio(m);
            return (
              <button
                key={c.id}
                role="option"
                aria-selected={i === selected}
                class={`strip-clip ${i === selected ? 'on' : ''} ${dragging ? 'lifted' : ''} ${audio ? 'audio' : ''}`}
                style={{ left: `${at * pps}px`, top: `${RULER + row * (ROW + GAP)}px`, width: `${Math.max(14, clipDuration(c) * pps)}px`, height: `${ROW}px` }}
                onPointerDown={down(i)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  if (swallow.current) return;
                  engine.pause();
                  selectClip(i);
                }}
              >
                {url && <span class="strip-thumb" style={{ backgroundImage: `url("${url}")` }} />}
                <span class="strip-label num">{c.speed !== 1 ? `${c.speed}× · ` : ''}{audio ? (m?.name ?? '') : fmtTime(clipDuration(c))}</span>
                {p !== undefined && (
                  <span class="tile-pie" title="Making a lighter copy for the preview">
                    <Pie value={p} size={16} />
                  </span>
                )}
              </button>
            );
          })}
          <div class="tl-playhead" style={{ left: `${playhead * pps}px`, height: `${height}px` }} />
        </div>
      </div>
    </div>
  );
}
