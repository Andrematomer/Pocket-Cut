import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { keyOf } from '../bake.ts';
import { engine } from '../engine.ts';
import { thumbUrl } from '../media.ts';
import { addSolid, addTextClip, deleteClip, deselect, duplicateClip, getState, moveClipTo, redo, removeGap, selectClip, set, splitAtPlayhead, toast, undo, updateClip, useStore } from '../store.ts';
import { PEAKS_PER_SEC } from '../wave.ts';
import { MIN_CLIP, clipDuration, clipEnd, fmtTime, gapAt, totalOf } from '../timeline.ts';
import type { Clip, MediaInfo } from '../types.ts';
import { PickLabel } from './Picker.tsx';
import { Pie } from './Pie.tsx';
import { Copy, Pause, Play, Plus, Redo, Split, Trash, Undo } from './icons.tsx';
import { outputSize } from '../geometry.ts';

const HOLD_MS = 350; // hold a strip this long (without moving) to pick it up
const WOBBLE = 10;
const EDGE = 44; // px from the edge of the timeline where dragging starts to scroll it
const ROW0 = 38;
const GAP = 4;
const RULER = 22;
const SNAP_PX = 8;
const MIN_PPS = 6;
const MAX_PPS = 300;

interface Move {
  index: number;
  at: number;
  track: number;
  /** top of the strip in timeline pixels: follows the finger smoothly, the lane is only chosen on release */
  top: number;
}
interface Trim {
  index: number;
  at: number;
  start: number;
  end: number;
}

/** the yellow line is inside the clip far enough from both ends to cut there */
function splitOk(c: Clip, ph: number): boolean {
  const local = (ph - c.at) * c.speed;
  return local >= MIN_CLIP && c.end - c.start - local >= MIN_CLIP;
}

const isAudio = (m: MediaInfo | undefined) => m?.kind === 'audio';

/**
 * The lanes shown, top to bottom. Picture and video lanes count up from lane 0, sound lanes down from
 * -1. One empty lane is open beyond the last used one on each side, so a clip cannot get lost far away.
 */
export function lanesFor(clips: Clip[]): number[] {
  let hi = 0;
  let lo = 0;
  for (const c of clips) {
    if (c.track >= 0) hi = Math.max(hi, c.track);
    else lo = Math.min(lo, c.track);
  }
  const out: number[] = [];
  for (let t = hi + 1; t >= lo - 1; t--) out.push(t);
  return out;
}

/**
 * The timeline. The yellow line is fixed; the timeline scrolls under it, and the position is wherever
 * the line is. Lanes higher up are drawn on top of the ones below; sound lives on the lanes under lane
 * 1. Tap a strip to select it (tap it again for its options). Hold a strip until it lifts, then drag it
 * in time or between lanes. A selected strip has handles on both ends: drag them to trim. Pinch to zoom.
 */
export function Timeline() {
  const clips = useStore((s) => s.project.clips);
  const media = useStore((s) => s.project.media);
  const selected = useStore((s) => s.selected);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const progress = useStore((s) => s.proxyProgress);
  const gap = useStore((s) => s.gap);
  const handles = useStore((s) => s.handles);
  const waves = useStore((s) => s.waves);
  const bakes = useStore((s) => s.bakeProgress);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const hasSel = selected >= 0 && !!clips[selected];
  const [menu, setMenu] = useState(false);
  const [pps, setPps] = useState(36); // pixels per second
  const [move, setMove] = useState<Move | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);
  const [viewW, setViewW] = useState(360);
  const scroller = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: number; i: number; x0: number; y0: number; x: number; y: number; at0: number; track0: number; scroll0: number; scrollTop0: number; timer: number; active: boolean; raf: number } | null>(null);
  const swallow = useRef(false);

  const prefRow = useStore((s) => s.prefs.rowScale);
  const rowAuto = useStore((s) => s.prefs.rowAuto);
  const [viewH, setViewH] = useState(200);
  const lanes = lanesFor(clips);
  // auto: every lane that is shown fits the height of the timeline (between half and double the normal height)
  const autoScale = Math.min(2, Math.max(0.5, ((viewH - RULER - 6) / lanes.length - GAP) / ROW0));
  const rowScale = rowAuto ? autoScale : prefRow;
  const ROW = Math.round(ROW0 * rowScale);
  const total = totalOf(clips);
  const padL = Math.round(viewW / 3);
  const extent = Math.max(total, move ? move.at + (clips[move.index] ? clipDuration(clips[move.index]!) : 0) : 0);
  const width = extent * pps + viewW;
  const height = RULER + lanes.length * (ROW + GAP) + 6;
  const live = useRef({ clips, pps, lanes, playhead, media, padL, height });
  live.current = { clips, pps, lanes, playhead, media, padL, height };
  const rowTop = (row: number) => RULER + row * (ROW + GAP);

  // the size of the viewport decides where the yellow line sits
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => (setViewW(el.clientWidth || 360), setViewH(el.clientHeight || 200)));
    ro.observe(el);
    setViewW(el.clientWidth || 360);
    setViewH(el.clientHeight || 200);
    return () => ro.disconnect();
  }, []);

  // the position moved by itself (playing, selecting a clip, zooming): scroll the timeline under the line
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const want = playhead * pps;
    if (Math.abs(el.scrollLeft - want) > 1.5) el.scrollLeft = want;
  }, [playhead, pps, viewW, total]);

  // the person scrolled: the position follows (one preview refresh per frame at most)
  const seekFrame = useRef(0);
  const pinching = useRef(false);
  const onScroll = () => {
    const el = scroller.current;
    if (!el || pinching.current) return;
    const t = Math.max(0, Math.min(totalOf(live.current.clips), el.scrollLeft / live.current.pps));
    if (Math.abs(t - live.current.playhead) * live.current.pps < 1.5) return;
    if (getState().playing) engine.pause();
    set({ playhead: t });
    if (!seekFrame.current)
      seekFrame.current = requestAnimationFrame(() => {
        seekFrame.current = 0;
        void engine.showAt(getState().playhead);
      });
  };

  // touch: pinch to zoom, and no scrolling while a strip is picked up
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let pinch: { d0: number; pps0: number } | null = null;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = { d0: dist(e), pps0: live.current.pps };
        pinching.current = true;
        if (st.current) {
          clearTimeout(st.current.timer);
          st.current = null;
        }
      }
    };
    const mv = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, (pinch.pps0 * dist(e)) / pinch.d0)));
      } else if (st.current?.active || trimRef.current) e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) (pinch = null, (pinching.current = false));
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', mv, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', mv);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  // ---------- moving a strip ----------

  /** nearest snap point for a strip starting at `at` that is `dur` long */
  const snap = (index: number, at: number, dur: number): number => {
    const { clips: cs, pps: k, playhead: ph } = live.current;
    const limit = SNAP_PX / k;
    const points = [0, ph];
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

  const frame = () => {
    const s = st.current;
    const el = scroller.current;
    if (!s || !s.active || !el) return;
    const { clips: cs, pps: k, lanes: ln, height: h } = live.current;
    const clip = cs[s.i];
    if (!clip) return;
    const r = el.getBoundingClientRect();
    let vx = 0;
    if (s.x < r.left + EDGE) vx = -Math.ceil(((r.left + EDGE - s.x) / EDGE) * 14);
    else if (s.x > r.right - EDGE) vx = Math.ceil(((s.x - (r.right - EDGE)) / EDGE) * 14);
    if (vx) el.scrollLeft += vx;
    let vy = 0;
    if (s.y < r.top + RULER + 14) vy = -Math.ceil(Math.min(1, (r.top + RULER + 14 - s.y) / 40) * 2.5);
    else if (s.y > r.bottom - 24) vy = Math.ceil(Math.min(1, (s.y - (r.bottom - 24)) / 40) * 2.5);
    if (vy) el.scrollTop += vy;
    const raw = s.at0 + (s.x - s.x0 + (el.scrollLeft - s.scroll0)) / k;
    const at = snap(s.i, raw, clipDuration(clip));
    const baseRow = ln.indexOf(s.track0);
    const top = Math.max(RULER, Math.min(h - ROW - 4, RULER + baseRow * (ROW + GAP) + (s.y - s.y0) + (el.scrollTop - s.scrollTop0)));
    let row = Math.round((top - RULER) / (ROW + GAP));
    row = Math.max(0, Math.min(ln.length - 1, row));
    const track = ln[row]!;
    setMove({ index: s.i, at, track, top });
    s.raf = requestAnimationFrame(frame);
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
      setMove((d) => {
        if (commit && d) {
          const c = live.current.clips[d.index];
          if (c && (d.at !== c.at || d.track !== c.track)) moveClipTo(d.index, d.at, d.track);
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
    const s = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at0: clip.at, track0: clip.track, scroll0: el.scrollLeft, scrollTop0: el.scrollTop, timer: 0, active: false, raf: 0 };
    st.current = s;
    s.timer = window.setTimeout(() => {
      s.active = true;
      s.scroll0 = el.scrollLeft;
      s.scrollTop0 = el.scrollTop;
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
      const row = live.current.lanes.indexOf(clip.track);
      setMove({ index: i, at: clip.at, track: clip.track, top: rowTop(row) });
      s.raf = requestAnimationFrame(frame);
    }, HOLD_MS);
  };
  const onMove = (e: PointerEvent) => {
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

  // ---------- trimming with the handles of the selected strip ----------

  const trimRef = useRef<{ id: number; i: number; side: 'left' | 'right'; x0: number; base: { at: number; start: number; end: number }; cur: Trim } | null>(null);

  const solveTrim = (t: NonNullable<typeof trimRef.current>, dx: number): Trim => {
    const clip = live.current.clips[t.i]!;
    const m = live.current.media[clip.mediaId];
    const dur = m?.duration ?? clip.end;
    const k = live.current.pps;
    let dt = dx / k; // timeline seconds
    const b = t.base;
    if (t.side === 'left') {
      dt = Math.max(dt, -b.at, -b.start / clip.speed);
      dt = Math.min(dt, (b.end - MIN_CLIP - b.start) / clip.speed);
      return { index: t.i, at: b.at + dt, start: b.start + dt * clip.speed, end: b.end };
    }
    dt = Math.max(dt, (b.start + MIN_CLIP - b.end) / clip.speed);
    dt = Math.min(dt, (dur - b.end) / clip.speed);
    return { index: t.i, at: b.at, start: b.start, end: b.end + dt * clip.speed };
  };
  const trimDown = (i: number, side: 'left' | 'right') => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const clip = clips[i];
    if (!clip) return;
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const t = { id: e.pointerId, i, side, x0: e.clientX, base: { at: clip.at, start: clip.start, end: clip.end }, cur: { index: i, at: clip.at, start: clip.start, end: clip.end } };
    trimRef.current = t;
    setTrim(t.cur);
  };
  const trimMove = (e: PointerEvent) => {
    const t = trimRef.current;
    if (!t || e.pointerId !== t.id) return;
    t.cur = solveTrim(t, e.clientX - t.x0);
    setTrim(t.cur);
    engine.scrubSource(t.i, t.side === 'left' ? t.cur.start : Math.max(t.cur.start, t.cur.end - 0.05), false);
  };
  const trimUp = (e: PointerEvent) => {
    const t = trimRef.current;
    if (!t || e.pointerId !== t.id) return;
    trimRef.current = null;
    setTrim(null);
    const c = t.cur;
    // a tap on a handle (no drag) puts the handles away, which is how a very short strip gets them back off
    if (e.type === 'pointerup' && Math.abs(e.clientX - t.x0) < 6) set({ handles: false });
    else if (e.type === 'pointerup' && (c.at !== t.base.at || c.start !== t.base.start || c.end !== t.base.end)) updateClip(t.i, { at: Math.round(c.at * 100) / 100, start: c.start, end: c.end });
    void engine.showAt(getState().playhead);
  };

  // tapping empty space between two strips picks that gap (red box with a trash can)
  const laneTap = (e: MouseEvent, track: number) => {
    if (swallow.current || e.target !== e.currentTarget) return;
    setMenu(false);
    const el = scroller.current;
    if (!el) return;
    const x = e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
    const t = (x - padL) / pps;
    const g = gapAt(clips, track, t);
    if (!g) {
      deselect(); // empty lane space: nothing is selected any more
      return;
    }
    engine.pause();
    set({ gap: g, drawer: null, selected: -1, handles: false, boxMode: false });
  };
  // ---------- the middle bar is also the handle that trades height between preview and timeline ----------
  const barDrag = useRef<{ id: number; y0: number; h0: number; lo: number; hi: number } | null>(null);
  const barDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('button, label, input, .add-menu')) return; // buttons only tap
    const app = document.querySelector('.app') as HTMLElement | null;
    const stage = document.querySelector('.stage') as HTMLElement | null;
    if (!app || !stage) return;
    const h0 = parseFloat(getComputedStyle(app).getPropertyValue('--tl-h')) || 200;
    const cs = getComputedStyle(stage);
    const px = (v: string) => parseFloat(v) || 0;
    const o = outputSize(getState().project);
    const needed = Math.ceil((stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)) / (o.w / o.h)) + px(cs.paddingTop) + px(cs.paddingBottom);
    const room = stage.clientHeight;
    // the timeline cannot shrink once the preview already has all the height its width can use
    const lo = Math.max(90, Math.min(h0, h0 + room - needed));
    const hi = Math.max(lo, h0 + room - 96); // the preview always keeps a little height, so nothing is pushed off the screen
    barDrag.current = { id: e.pointerId, y0: e.clientY, h0, lo, hi };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
  };
  const barMove = (e: PointerEvent) => {
    const d = barDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const h = Math.round(Math.max(d.lo, Math.min(d.hi, d.h0 + (d.y0 - e.clientY))));
    window.dispatchEvent(new CustomEvent('pc-tl-height', { detail: h }));
  };
  const barUp = (e: PointerEvent) => {
    const d = barDrag.current;
    if (!d || d.id !== e.pointerId) return;
    barDrag.current = null;
    try {
      localStorage.setItem('pocket-cut-nla:tl-height', String(Math.round(parseFloat(getComputedStyle(document.querySelector('.app')!).getPropertyValue('--tl-h')) || 200)));
    } catch {
      /* ignore */
    }
  };
  const gapRow = gap ? lanes.indexOf(gap.track) : -1;

  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 56) ?? 300;
  const ticks: number[] = [];
  for (let t = 0; t <= total + viewW / pps; t += step) ticks.push(t);

  return (
    <div class={`tl ${move ? 'dragging' : ''}`}>
      <div class="tl-bar" onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}>
        <div class="tl-left">
          <button class={`tl-add ${menu ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Plus /> <span>Add</span>
          </button>
          {menu && (
            <>
              <div class="add-scrim" onPointerDown={() => setMenu(false)} />
              <div class="add-menu" role="menu">
                <PickLabel class="add-item" label="Add videos, pictures or sound">
                  <span onClick={() => window.setTimeout(() => setMenu(false), 600)}>Media</span>
                </PickLabel>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    engine.pause();
                    void addTextClip();
                  }}
                >
                  Text
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    engine.pause();
                    void addSolid('#2f6fed');
                  }}
                >
                  Color
                </button>
              </div>
            </>
          )}
        </div>
        <button class="tl-btn wide" disabled={!hasSel} onClick={() => (engine.pause(), deleteClip(selected))} aria-label="Delete the selected clip">
          <Trash /> <span>Delete</span>
        </button>
        <button class="play" onClick={() => (playing ? engine.pause() : void engine.play())} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button class="tl-btn" disabled={!canUndo} onClick={undo} aria-label="Undo">
          <Undo />
        </button>
        <button class="tl-btn" disabled={!canRedo} onClick={redo} aria-label="Redo">
          <Redo />
        </button>
        <button
          class="tl-btn"
          disabled={!hasSel}
          onClick={() => {
            if (!splitAtPlayhead()) toast('Move the yellow line into this clip, away from its edges, to cut there.');
          }}
          aria-label="Split the selected clip at the yellow line"
        >
          <Split />
        </button>
        <button class="tl-btn" disabled={!hasSel} onClick={() => (engine.pause(), duplicateClip(selected))} aria-label="Duplicate the selected clip">
          <Copy />
        </button>
      </div>
      <div class="tl-wrap">
        <div class="tl-scroll" ref={scroller} onScroll={onScroll}>
          <div class="tl-inner" style={{ width: `${width}px`, minHeight: `${height}px` }} onClick={(e) => e.target === e.currentTarget && deselect()}>
            <div class="tl-ruler" style={{ height: `${RULER}px` }}>
              {ticks.map((t) => (
                <span key={t} class="tl-tick num" style={{ left: `${padL + t * pps}px` }}>
                  {fmtTime(t, 0)}
                </span>
              ))}
            </div>
            <div class="tl-void" style={{ left: 0, width: `${padL}px` }} />
            <div class="tl-void" style={{ left: `${padL + total * pps}px`, right: 0 }} />
            {lanes.map((track, row) => (
              <div key={track} class={`tl-lane ${move?.track === track ? 'target' : ''}`} style={{ top: `${rowTop(row)}px`, height: `${ROW}px` }} onClick={(e) => laneTap(e, track)}>
                <span class="tl-lane-name">{track}</span>
              </div>
            ))}
            {gap && gapRow >= 0 && (
              <div class="tl-gap" style={{ left: `${padL + gap.from * pps}px`, width: `${(gap.to - gap.from) * pps}px`, top: `${rowTop(gapRow)}px`, height: `${ROW}px` }}>
                <button class="gap-trash" aria-label={`Remove the ${fmtTime(gap.to - gap.from)} gap`} onClick={() => removeGap()}>
                  <Trash />
                </button>
              </div>
            )}
            {clips.map((c, i) => {
              const m = media[c.mediaId];
              const moving = move?.index === i;
              const tr = trim?.index === i ? trim : null;
              const at = moving ? move!.at : (tr?.at ?? c.at);
              const start = tr?.start ?? c.start;
              const end = tr?.end ?? c.end;
              const track = moving ? move!.track : c.track;
              const row = lanes.indexOf(track);
              if (row < 0) return null;
              const top = moving ? move!.top : rowTop(row);
              const url = thumbUrl(c.mediaId);
              const p = progress[c.mediaId];
              const audio = isAudio(m);
              const w = Math.max(14, ((end - start) / c.speed) * pps);
              const on = i === selected;
              const baking = bakes[keyOf(c)];
              const wave = audio ? waves[c.mediaId] : undefined;
              return (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={on}
                  class={`strip-clip ${on ? 'on' : ''} ${moving ? 'lifted' : ''} ${audio ? 'audio' : ''} ${m?.text ? 'texty' : ''} ${m?.solid ? 'solid' : ''} ${baking !== undefined ? 'baking' : ''}`}
                  style={{ left: `${padL + at * pps}px`, top: `${top}px`, width: `${w}px`, height: `${ROW}px`, ...(m?.solid ? { background: m.solid } : {}) }}
                  onPointerDown={down(i)}
                  onPointerMove={onMove}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (swallow.current) return;
                    engine.pause();
                    if (on) set({ handles: !getState().handles });
                    else selectClip(i);
                  }}
                >
                  {wave && <Wave peaks={wave} from={start} to={end} width={w} />}
                  {baking !== undefined && (
                    <span class="strip-pie" title="Preparing the sound for the preview">
                      <Pie value={baking} size={Math.max(14, Math.min(22, ROW - 10))} />
                    </span>
                  )}
                  {url && !m?.text && <span class="strip-thumb" style={{ backgroundImage: `url("${url}")`, backgroundPosition: `${-((tr?.at ?? c.at) - c.at) * pps}px center` }} />}
                  <span class="strip-label num">
                    {c.speed !== 1 ? `${c.speed}× · ` : ''}
                    {audio || m?.text || m?.solid ? (m?.name ?? '') : fmtTime((end - start) / c.speed)}
                  </span>
                  {p !== undefined && (
                    <span class="tile-pie" title="Making a lighter copy for the preview">
                      <Pie value={p} size={16} />
                    </span>
                  )}
                  {on && handles && !moving && !tr && splitOk(c, playhead) && (
                    <span class="split-line" style={{ left: `${(playhead - c.at) * pps}px` }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), splitAtPlayhead())} aria-label="Split here" />
                  )}
                  {on && handles && !moving && (
                    <>
                      <span class="trim-h left" onPointerDown={trimDown(i, 'left')} onPointerMove={trimMove} onPointerUp={trimUp} onPointerCancel={trimUp} onClick={(e) => e.stopPropagation()} />
                      <span class="trim-h right" onPointerDown={trimDown(i, 'right')} onPointerMove={trimMove} onPointerUp={trimUp} onPointerCancel={trimUp} onClick={(e) => e.stopPropagation()} />
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div class="tl-time num" style={{ left: `${padL}px` }}>{fmtTime(playhead, 2)}</div>
        <div class="tl-playhead" style={{ left: `${padL}px` }} />
      </div>
    </div>
  );
}

/** The loudness outline of the part of a sound file that the strip shows. */
function Wave({ peaks, from, to, width }: { peaks: Uint8Array; from: number; to: number; width: number }) {
  const a = Math.max(0, Math.floor(from * PEAKS_PER_SEC));
  const b = Math.min(peaks.length, Math.ceil(to * PEAKS_PER_SEC));
  const n = b - a;
  if (n < 2) return null;
  // no more than about one bar per 1.5 px
  const group = Math.max(1, Math.floor(n / Math.max(8, width / 1.5)));
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0, x = 0; i < n; i += group, x++) {
    let v = 0;
    for (let k = i; k < Math.min(n, i + group); k++) v = Math.max(v, peaks[a + k]!);
    const h = (v / 255) * 46 + 1;
    top.push(`${x},${50 - h}`);
    bottom.unshift(`${x},${50 + h}`);
  }
  const cols = top.length;
  return (
    <svg class="strip-wave" viewBox={`0 0 ${cols - 1} 100`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={[...top, ...bottom].join(' ')} />
    </svg>
  );
}
