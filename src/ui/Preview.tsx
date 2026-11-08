import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { baseScale, clampView, clampZoom, dragView, fitZoom, normAngle, outputSize, pinchView, snapEightCropped, snapView, type Pt } from '../geometry.ts';
import { getState, selectClip, set, setCrop, updateClip, useStore } from '../store.ts';
import { localPoint } from '../turn.ts';
import { activeAt, fmtTime, totalOf } from '../timeline.ts';
import type { Crop, View } from '../types.ts';
import { Pause, Play } from './icons.tsx';
import { Pie } from './Pie.tsx';

export function Preview() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.proxyProgress);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [avail, setAvail] = useState({ w: 0, h: 0 });

  const clip = project.clips[selected];
  const media = clip && project.media[clip.mediaId];

  // the preview always has the shape of the exported video, so the picture can be placed on it directly
  const o = outputSize(project);
  const aspect = o.w / o.h;
  const has = project.clips.length > 0;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const px = (v: string) => parseFloat(v) || 0;
      setAvail({
        w: Math.max(0, el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)),
        h: Math.max(0, el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)),
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [has]);

  useEffect(() => {
    if (avail.w === 0) return;
    let w = avail.w;
    let h = w / aspect;
    if (h > avail.h) {
      h = avail.h;
      w = h * aspect;
    }
    setBox({ w: Math.floor(w), h: Math.floor(h) });
  }, [avail.w, avail.h, aspect]);

  // canvas backing store follows the box (crisp on high-DPI screens, capped for speed)
  useEffect(() => {
    const c = canvas.current;
    if (!c || box.w === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(2, Math.round(box.w * dpr));
    c.height = Math.max(2, Math.round(box.h * dpr));
    engine.attach(c);
  }, [box.w, box.h, has]);

  useEffect(() => () => engine.attach(null), []);

  // any edit that changes the picture, not the position in time
  useEffect(() => {
    engine.draw();
  }, [project]);

  // structural changes (import, delete, split, reorder, select): show the right frame again
  const idsKey = project.clips.map((c) => c.id).join();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (project.clips.length === 0) return;
    }
    void engine.showAt(Math.min(getState().playhead, totalOf(project.clips))).then(() => set({ playhead: engine.tl }));
  }, [idsKey, selected]);

  if (!has) return <div class="stage" ref={wrap} />;

  return (
    <div class="stage" ref={wrap}>
      <div class="frame" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <canvas ref={canvas} style={{ width: `${box.w}px`, height: `${box.h}px` }} />
        {box.w > 0 && <Gestures boxW={box.w} boxH={box.h} />}
        {box.w > 0 && clip && media && <TransformBox boxW={box.w} boxH={box.h} />}
        {busy && <div class="overlay-note">{busy}</div>}
        {!busy && clip && progress[clip.mediaId] !== undefined && (
          <div class="overlay-note with-pie">
            <Pie value={progress[clip!.mediaId]!} size={16} />
            <span>Making a lighter copy for smooth preview… {Math.round(progress[clip!.mediaId]! * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}


const fmtDeg = (d: number) => `${Math.round(d)}°`;
const HOLD_MS = 900; // on the preview fine control takes twice as long: it is too easy to trigger by accident here
const JITTER = 10;
const FINE = 0.1;

type Clip0 = ReturnType<typeof getState>['project']['clips'][number];

/**
 * Moves the picture on the canvas with the fingers: one finger drags, two fingers pinch to zoom and
 * twist to turn. Magnets pull to the center lines, quarter turns, "whole picture fits" and "fills".
 * Hold still for a moment (at any point of the gesture, with one finger or two) and the picture moves
 * ten times slower, with the magnets off, for exact placement.
 *
 * While fingers are down the view is only drawn (never saved); it is saved when the last finger lifts.
 * Finger bookkeeping is defensive: iOS can lose a touch (for example when a finger slides into the
 * home-bar area) without telling the page, which must never leave a "ghost finger" behind.
 */
function Gestures({ boxW, boxH }: { boxW: number; boxH: number }) {
  const selected = useStore((s) => s.selected);
  const root = useRef<HTMLDivElement>(null);
  const guideV = useRef<HTMLDivElement>(null);
  const guideH = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, Pt>());
  const arm = useRef(new Map<number, Pt>());
  const base = useRef<{ view: View; a: Pt; b: Pt | null; ids: number[] } | null>(null);
  const live = useRef<View | null>(null);
  const fine = useRef(false);
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean; multi: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const timer = useRef(0);
  const cropTimer = useRef(0);
  const frame = useRef(0);
  const sizes = useRef({ boxW, boxH });
  sizes.current = { boxW, boxH };

  const current = (): { clip: Clip0; media: NonNullable<ReturnType<typeof getState>['project']['media'][string]> } | null => {
    const st = getState();
    const clip = st.project.clips[st.selected];
    const media = clip && st.project.media[clip.mediaId];
    return clip && media ? { clip, media } : null;
  };
  const showBadge = (text: string) => {
    const b = badge.current;
    if (!b) return;
    b.textContent = text;
    b.classList.toggle('on', !!text);
  };
  const guides = (s: ReturnType<typeof snapView> | null) => {
    guideV.current?.classList.toggle('on', !!s?.x);
    guideH.current?.classList.toggle('on', !!s?.y);
    if (fine.current) return;
    showBadge(s ? (s.zoom === 'fit' ? 'Fit' : s.zoom === 'fill' ? 'Fill' : s.rot !== null ? fmtDeg(s.rot) : s.edge ? 'Edge' : '') : '');
  };
  const setFineLook = (on: boolean) => {
    fine.current = on;
    root.current?.parentElement?.classList.toggle('fine', on);
    if (on) {
      guideV.current?.classList.remove('on');
      guideH.current?.classList.remove('on');
      showBadge('FINE');
    } else showBadge('');
  };
  const rebase = () => {
    const c = current();
    if (!c) return;
    const ids = [...pts.current.keys()].slice(0, 2);
    base.current = ids.length ? { view: live.current ?? c.clip.view, a: pts.current.get(ids[0]!)!, b: ids[1] !== undefined ? pts.current.get(ids[1])! : null, ids } : null;
    arm.current = new Map(pts.current);
  };
  /** (re)starts the hold timer: still fingers for this long switch to fine control from where they are */
  const startTimer = () => {
    clearTimeout(timer.current);
    arm.current = new Map(pts.current);
    timer.current = window.setTimeout(() => {
      if (pts.current.size === 0 || fine.current) return;
      rebase();
      setFineLook(true);
    }, HOLD_MS);
  };
  const paint = () => {
    frame.current = 0;
    engine.draw();
  };
  /** ends everything: saves the picture where it is and forgets all fingers */
  const flush = () => {
    clearTimeout(timer.current);
    pts.current.clear();
    arm.current.clear();
    base.current = null;
    guides(null);
    setFineLook(false);
    const v = live.current;
    live.current = null;
    if (v && v !== getState().project.clips[getState().selected]?.view) {
      updateClip(getState().selected, { view: v });
      engine.live = null;
      engine.draw();
    }
  };

  useEffect(() => {
    // safety nets: the element's own events are enough on a good day
    const lost = (e: PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      pts.current.delete(e.pointerId);
      if (pts.current.size === 0) flush();
      else (rebase(), startTimer());
    };
    const touchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0 && pts.current.size > 0) flush();
    };
    const hide = () => flush();
    window.addEventListener('pointerup', lost);
    window.addEventListener('pointercancel', lost);
    window.addEventListener('touchend', touchEnd);
    window.addEventListener('touchcancel', touchEnd);
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pointerup', lost);
      window.removeEventListener('pointercancel', lost);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchEnd);
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', hide);
      flush();
    };
  }, []);

  const rel = (e: PointerEvent): Pt => {
    const p = localPoint((e.currentTarget as HTMLElement).getBoundingClientRect(), e.clientX, e.clientY);
    return { x: p.x - sizes.current.boxW / 2, y: p.y - sizes.current.boxH / 2 };
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    // the first finger of a gesture: anything still remembered from before is a lost finger
    if (e.isPrimary && pts.current.size > 0) flush();
    // work on the clip that is on screen (playback may have moved on from the selected one)
    const st0 = getState();
    const visible = activeAt(st0.project.clips, st0.playhead);
    // a finger put on the picture picks the top-most strip under it, whatever was selected before
    if (pts.current.size === 0 && st0.multi.length === 0) {
      const q = rel(e);
      const { boxW: W, boxH: H } = sizes.current;
      for (const i of [...visible].reverse()) {
        const c = st0.project.clips[i]!;
        const m = st0.project.media[c.mediaId];
        if (!m || m.kind === 'audio') continue;
        const inset = m.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
        const cr = c.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const k = m.solid !== undefined ? cr : { l: Math.max(cr.l, inset.l), t: Math.max(cr.t, inset.t), r: Math.max(cr.r, inset.r), b: Math.max(cr.b, inset.b) };
        const sc = baseScale(m.width, m.height, W, H) * c.view.zoom;
        const a = (c.view.rot * Math.PI) / 180;
        const dx = q.x - c.view.x * W;
        const dy = q.y - c.view.y * H;
        const lx = dx * Math.cos(a) + dy * Math.sin(a);
        const ly = -dx * Math.sin(a) + dy * Math.cos(a);
        const pw = m.width * sc;
        const ph = m.height * sc;
        if (lx >= -pw / 2 + k.l * pw && lx <= pw / 2 - k.r * pw && ly >= -ph / 2 + k.t * ph && ly <= ph / 2 - k.b * ph) {
          if (i !== st0.selected) selectClip(i, { keepPlayhead: true });
          break;
        }
      }
    }
    if (!visible.includes(getState().selected)) {
      const shown = engine.currentIndex();
      if (shown >= 0) set({ selected: shown });
    }
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    pts.current.set(e.pointerId, rel(e));
    if (pts.current.size > 1) {
      if (tap.current) tap.current.multi = true;
    } else tap.current = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false, multi: false };
    const c = current();
    if (c && !live.current) live.current = c.clip.view;
    rebase();
    startTimer();
  };
  const move = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    if (e.pointerType === 'mouse' && e.buttons === 0) return flush(); // button released somewhere we did not see
    pts.current.set(e.pointerId, rel(e));
    const tp = tap.current;
    if (tp && Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > JITTER) tp.moved = true;
    const b = base.current;
    const c = current();
    if (!b || !c) return;
    if (!fine.current) {
      // any finger moving more than a wobble restarts the hold timer
      for (const [id, p] of pts.current) {
        const q = arm.current.get(id);
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) > JITTER) return void (startTimer(), step(b, c));
      }
    }
    step(b, c);
  };
  const step = (b: NonNullable<typeof base.current>, c: NonNullable<ReturnType<typeof current>>) => {
    const { boxW: W, boxH: H } = sizes.current;
    const raw1 = pts.current.get(b.ids[0]!);
    const raw2 = b.b ? pts.current.get(b.ids[1]!) : undefined;
    if (!raw1 || (b.b && !raw2)) return;
    // in fine mode the fingers' movement counts a tenth
    const f = (p: Pt, q: Pt): Pt => (fine.current ? { x: q.x + (p.x - q.x) * FINE, y: q.y + (p.y - q.y) * FINE } : p);
    const a1 = f(raw1, b.a);
    let v: View;
    if (b.b && raw2) v = pinchView(b.view, W, H, b.a, b.b, a1, f(raw2, b.b));
    else v = dragView(b.view, W, H, a1.x - b.a.x, a1.y - b.a.y);
    v = clampView(v, { sw: c.media.width, sh: c.media.height, W, H });
    if (fine.current) {
      live.current = v;
      engine.live = { index: getState().selected, view: v };
    } else {
      const sn = snapView(v, { sw: c.media.width, sh: c.media.height, W, H });
      live.current = sn.view;
      engine.live = { index: getState().selected, view: sn.view };
      guides(sn);
    }
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const up = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size > 0) {
      // a finger lifted or was added: carry on from where the picture is now
      rebase();
      startTimer();
      return;
    }
    const tp = tap.current;
    tap.current = null;
    flush();
    if (tp && !tp.moved && !tp.multi && performance.now() - tp.t < 300) {
      const lt = lastTap.current;
      if (lt && tp.t - lt.t < 400 && Math.hypot(tp.x - lt.x, tp.y - lt.y) < 40) {
        lastTap.current = null;
        clearTimeout(cropTimer.current);
        doubleTap();
      } else {
        lastTap.current = { t: tp.t, x: tp.x, y: tp.y };
        // a single tap shows or hides the crop handles (after the time a second tap would need)
        clearTimeout(cropTimer.current);
        cropTimer.current = window.setTimeout(() => set({ boxMode: !getState().boxMode }), 330);
      }
    }
  };
  /** snaps to the closest of the eight tidy placements (quarter turn x fit/fill); again flips fit/fill */
  const doubleTap = () => {
    const c = current();
    if (!c) return;
    const { boxW: W, boxH: H } = sizes.current;
    const v = clampView(snapEightCropped(c.clip.view, c.clip.crop, c.media.width, c.media.height, W, H), { sw: c.media.width, sh: c.media.height, W, H });
    updateClip(getState().selected, { view: v });
    const fit = fitZoom(c.media.width, c.media.height, v.rot, W, H);
    showBadge(Math.abs(v.zoom - fit) / fit < 0.02 ? 'Fit' : 'Fill');
    window.setTimeout(() => !fine.current && showBadge(''), 700);
  };
  const wheel = (e: WheelEvent) => {
    // desktop: scroll to zoom
    const c = current();
    if (!c) return;
    e.preventDefault();
    const z = c.clip.view.zoom * Math.exp(-e.deltaY / 500);
    const s = snapView(clampView({ ...c.clip.view, zoom: z }, { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH }), { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH });
    updateClip(getState().selected, { view: s.view });
  };

  return (
    <div class="gestures" ref={root} key={selected} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <div class="guide v" ref={guideV} />
      <div class="guide h" ref={guideH} />
      <div class="gesture-badge num" ref={badge} />
    </div>
  );
}

type Handle = 'tl' | 'tr' | 'br' | 'bl' | 'l' | 't' | 'r' | 'b' | 'rot';

/** fingers on the screen right now (any element), and whether one of them is on the transform box */
const fingers = new Set<number>();
let onBox = 0;

/**
 * The transform box of the selected clip: corners scale, the round handle on top turns, the sides crop.
 * It is an alternative to the finger gestures, not a replacement. It hides as soon as a second finger
 * touches the screen or a finger starts a gesture on the picture, and a second finger cancels a handle
 * that is being dragged, so the two ways never fight. The box may reach outside the canvas.
 */
function TransformBox({ boxW: W, boxH: H }: { boxW: number; boxH: number }) {
  const on = useStore((s) => s.boxMode);
  const selected = useStore((s) => s.selected);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const [drag, setDrag] = useState<{ view: View; crop: Crop } | null>(null);
  const [quiet, setQuiet] = useState(false);
  const st = useRef<{ id: number; h: Handle; p0: Pt; view0: View; crop0: Crop; last: Pt; anchor: Pt; fineRaw: Pt; fineEff: Pt; fine: boolean; timer: number; frame: HTMLElement | null } | null>(null);

  const endFine = () => {
    const d = st.current;
    if (!d) return;
    clearTimeout(d.timer);
    d.frame?.classList.remove('fine');
  };
  const cancel = () => {
    if (!st.current) return;
    endFine();
    st.current = null;
    setDrag(null);
    engine.live = null;
    engine.cropLive = null;
    engine.ghost = false;
    engine.draw();
  };

  useEffect(() => {
    const down = (e: PointerEvent) => {
      // the first finger of a new touch: anything still remembered from before was lost
      if (e.isPrimary) (fingers.clear(), (onBox = 0));
      fingers.add(e.pointerId);
      const el = e.target as Element | null;
      const mine = !!el?.closest?.('.tbox-h');
      if (mine) onBox = e.pointerId;
      // anything outside the preview (timeline, tabs, header...) puts the box away
      if (!el?.closest?.('.frame') && getState().boxMode) set({ boxMode: false });
      if (fingers.size >= 2 || !mine) cancel();
      setQuiet(fingers.size >= 2 || !mine);
    };
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      if (onBox === e.pointerId) onBox = 0;
      if (fingers.size === 0) setQuiet(false);
      else if (fingers.size === 1 && !onBox) setQuiet(true);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);

  // a different clip was selected: forget a drag in progress
  useEffect(cancel, [selected]);

  if (!on || quiet || !clip || !media || media.kind === 'audio') return null;
  const view = drag?.view ?? clip.view;
  // text: the box hugs the letters, so each side starts where the ink starts
  const inset: Crop = media.textBox ?? { l: 0, t: 0, r: 0, b: 0 };
  const stored: Crop = drag?.crop ?? clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const stretch = media.solid !== undefined; // a flat color has nothing to cut: its sides stretch it instead
  const crop: Crop = stretch ? stored : { l: Math.max(stored.l, inset.l), t: Math.max(stored.t, inset.t), r: Math.max(stored.r, inset.r), b: Math.max(stored.b, inset.b) };
  const sc = baseScale(media.width, media.height, W, H) * view.zoom;
  const pw = media.width * sc;
  const ph = media.height * sc;
  const a = (view.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = W / 2 + view.x * W;
  const cy = H / 2 + view.y * H;
  const at = (lx: number, ly: number): Pt => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos });
  const x0 = -pw / 2 + crop.l * pw;
  const x1 = pw / 2 - crop.r * pw;
  const y0 = -ph / 2 + crop.t * ph;
  const y1 = ph / 2 - crop.b * ph;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const pos: Record<Handle, Pt> = {
    tl: at(x0, y0),
    tr: at(x1, y0),
    br: at(x1, y1),
    bl: at(x0, y1),
    l: at(x0, ym),
    r: at(x1, ym),
    t: at(xm, y0),
    b: at(xm, y1),
    rot: at(xm, y0 - 34),
  };

  const frameBox = (e: PointerEvent): Pt => {
    return localPoint((e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect(), e.clientX, e.clientY);
  };
  const down = (h: Handle) => (e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (fingers.size > 1) return; // a second finger is on the screen: the box does nothing
    engine.pause();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone */
    }
    const p0 = frameBox(e);
    const frameEl = (e.currentTarget as HTMLElement).parentElement;
    const d = { id: e.pointerId, h, p0, view0: clip.view, crop0: crop, last: p0, anchor: p0, fineRaw: p0, fineEff: p0, fine: false, timer: 0, frame: frameEl };
    st.current = d;
    // hold still on a handle and it moves ten times slower, for exact work
    const arm = () => {
      clearTimeout(d.timer);
      d.timer = window.setTimeout(() => {
        if (st.current !== d || d.fine) return;
        d.fine = true;
        d.fineRaw = d.last;
        d.fineEff = d.last;
        d.frame?.classList.add('fine');
      }, 700);
    };
    (d as { arm?: () => void }).arm = arm;
    arm();
    void stretch;
  };

  /** where the finger counts as being: its real place, or (in fine control) a tenth of the way from where it started */
  const point = (e: PointerEvent): Pt => {
    const d = st.current!;
    const raw = frameBox(e);
    d.last = raw;
    if (d.fine) return { x: d.fineEff.x + (raw.x - d.fineRaw.x) * 0.1, y: d.fineEff.y + (raw.y - d.fineRaw.y) * 0.1 };
    if (Math.hypot(raw.x - d.anchor.x, raw.y - d.anchor.y) > 10) {
      d.anchor = raw;
      (d as { arm?: () => void }).arm?.();
    }
    return raw;
  };

  const solve = (e: PointerEvent): { view: View; crop: Crop } => {
    const d = st.current!;
    const P = point(e);
    const v0 = d.view0;
    const c0 = d.crop0;
    const s0 = baseScale(media.width, media.height, W, H) * v0.zoom;
    const w0 = media.width * s0;
    const h0 = media.height * s0;
    const a0 = (v0.rot * Math.PI) / 180;
    const co = Math.cos(a0);
    const si = Math.sin(a0);
    const C0 = { x: W / 2 + v0.x * W, y: H / 2 + v0.y * H };
    const loc = (lx: number, ly: number): Pt => ({ x: C0.x + lx * co - ly * si, y: C0.y + lx * si + ly * co });
    const ex0 = -w0 / 2 + c0.l * w0;
    const ex1 = w0 / 2 - c0.r * w0;
    const ey0 = -h0 / 2 + c0.t * h0;
    const ey1 = h0 / 2 - c0.b * h0;
    const env = { sw: media.width, sh: media.height, W, H };

    if (d.h === 'tl' || d.h === 'tr' || d.h === 'br' || d.h === 'bl') {
      const corner = (k: string) => loc(k.includes('l') ? ex0 : ex1, k.includes('t') ? ey0 : ey1);
      const opp = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' }[d.h];
      const A = corner(opp);
      const D = corner(d.h);
      const vx = D.x - A.x;
      const vy = D.y - A.y;
      const k = ((P.x - A.x) * vx + (P.y - A.y) * vy) / (vx * vx + vy * vy || 1);
      const zoom = clampZoom(v0.zoom * Math.max(0.05, k));
      const f = zoom / v0.zoom;
      const C = { x: A.x + f * (C0.x - A.x), y: A.y + f * (C0.y - A.y) };
      return { view: clampView({ ...v0, x: (C.x - W / 2) / W, y: (C.y - H / 2) / H, zoom }, env), crop: c0 };
    }
    if (d.h === 'rot') {
      const Cc = loc((ex0 + ex1) / 2, (ey0 + ey1) / 2);
      const ang = (p: Pt) => Math.atan2(p.y - Cc.y, p.x - Cc.x);
      let rot = v0.rot + ((ang(P) - ang(d.p0)) * 180) / Math.PI;
      const q = Math.round(rot / 45) * 45;
      if (Math.abs(rot - q) < 3) rot = q; // a small magnet at every 45 degrees
      const dr = ((rot - v0.rot) * Math.PI) / 180;
      const vx = C0.x - Cc.x;
      const vy = C0.y - Cc.y;
      const C = { x: Cc.x + vx * Math.cos(dr) - vy * Math.sin(dr), y: Cc.y + vx * Math.sin(dr) + vy * Math.cos(dr) };
      return { view: clampView({ ...v0, x: (C.x - W / 2) / W, y: (C.y - H / 2) / H, rot: normAngle(rot) }, env), crop: c0 };
    }
    // a side: cut it off along the picture's own axes
    const dx = P.x - d.p0.x;
    const dy = P.y - d.p0.y;
    const lx = dx * co + dy * si;
    const ly = -dx * si + dy * co;
    const c = { ...c0 };
    const room = 0.95;
    const lo = (side: keyof Crop) => (stretch ? -3 : inset[side]);
    if (d.h === 'l') c.l = Math.min(room - c.r, Math.max(lo('l'), c.l + lx / w0));
    if (d.h === 'r') c.r = Math.min(room - c.l, Math.max(lo('r'), c.r - lx / w0));
    if (d.h === 't') c.t = Math.min(room - c.b, Math.max(lo('t'), c.t + ly / h0));
    if (d.h === 'b') c.b = Math.min(room - c.t, Math.max(lo('b'), c.b - ly / h0));
    return { view: v0, crop: c };
  };

  const move = (e: PointerEvent) => {
    if (!st.current || st.current.id !== e.pointerId) return;
    const r = solve(e);
    setDrag(r);
    engine.live = { index: selected, view: r.view };
    engine.cropLive = { index: selected, crop: r.crop };
    engine.ghost = !stretch && st.current.h !== 'rot' && st.current.h.length === 1; // while cutting, the cut-off part shows faintly
    engine.draw();
  };
  const up = (e: PointerEvent) => {
    const d = st.current;
    if (!d || d.id !== e.pointerId) return;
    const r = e.type === 'pointerup' ? solve(e) : { view: d.view0, crop: d.crop0 };
    endFine();
    st.current = null;
    setDrag(null);
    engine.live = null;
    engine.cropLive = null;
    engine.ghost = false;
    if (r.view !== d.view0) updateClip(selected, { view: r.view });
    if (r.crop !== d.crop0) {
      const z = (v: number, i: number) => (!stretch && v <= i + 1e-6 ? 0 : Math.abs(v) < 1e-6 ? 0 : v);
      setCrop(selected, { l: z(r.crop.l, inset.l), t: z(r.crop.t, inset.t), r: z(r.crop.r, inset.r), b: z(r.crop.b, inset.b) });
    }
    engine.draw();
  };

  const poly = [pos.tl, pos.tr, pos.br, pos.bl].map((p) => `${p.x},${p.y}`).join(' ');
  const handle = (h: Handle, cls: string) => (
    <div key={h} class={`tbox-h ${cls}`} style={{ left: `${pos[h].x}px`, top: `${pos[h].y}px`, transform: cls.includes('side') ? `rotate(${view.rot}deg)` : undefined }} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={h === 'rot' ? 'Turn' : cls.includes('side') ? (stretch ? `Stretch ${h}` : `Crop ${h}`) : 'Scale'} />
  );
  return (
    <>
      <svg class="tbox" width={W} height={H} aria-hidden="true">
        <polygon points={poly} />
        <line x1={at(xm, y0).x} y1={at(xm, y0).y} x2={pos.rot.x} y2={pos.rot.y} />
      </svg>
      {handle('t', `side h ${stretch ? 'stretch' : ''}`)}
      {handle('b', `side h ${stretch ? 'stretch' : ''}`)}
      {handle('l', `side v ${stretch ? 'stretch' : ''}`)}
      {handle('r', `side v ${stretch ? 'stretch' : ''}`)}
      {handle('tl', 'corner')}
      {handle('tr', 'corner')}
      {handle('br', 'corner')}
      {handle('bl', 'corner')}
      {handle('rot', 'rotor')}
    </>
  );
}
