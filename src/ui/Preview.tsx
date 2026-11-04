import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { clampView, dragView, fitZoom, outputSize, pinchView, snapEight, snapView, type Pt } from '../geometry.ts';
import { getState, set, updateClip, useStore } from '../store.ts';
import { activeAt, fmtTime, totalOf } from '../timeline.ts';
import type { View } from '../types.ts';
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
  let aspect = 9 / 16;
  if (clip && media) {
    const o = outputSize(project);
    aspect = o.w / o.h;
  }

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
  }, [!!clip]);

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
  }, [box.w, box.h, !!clip]);

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

  if (!clip || !media) return <div class="stage" ref={wrap} />;

  return (
    <div class="stage" ref={wrap}>
      <div class="frame" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <canvas ref={canvas} style={{ width: `${box.w}px`, height: `${box.h}px` }} />
        {box.w > 0 && <Gestures boxW={box.w} boxH={box.h} />}
        {busy && <div class="overlay-note">{busy}</div>}
        {!busy && progress[clip.mediaId] !== undefined && (
          <div class="overlay-note with-pie">
            <Pie value={progress[clip.mediaId]!} size={16} />
            <span>Making a lighter copy for smooth preview… {Math.round(progress[clip.mediaId]! * 100)}%</span>
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
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left - sizes.current.boxW / 2, y: e.clientY - r.top - sizes.current.boxH / 2 };
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    // the first finger of a gesture: anything still remembered from before is a lost finger
    if (e.isPrimary && pts.current.size > 0) flush();
    // work on the clip that is on screen (playback may have moved on from the selected one)
    const st0 = getState();
    const visible = activeAt(st0.project.clips, st0.playhead);
    if (!visible.includes(st0.selected)) {
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
    v = clampView(v);
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
        doubleTap();
      } else lastTap.current = { t: tp.t, x: tp.x, y: tp.y };
    }
  };
  /** snaps to the closest of the eight tidy placements (quarter turn x fit/fill); again flips fit/fill */
  const doubleTap = () => {
    const c = current();
    if (!c) return;
    const { boxW: W, boxH: H } = sizes.current;
    const v = clampView(snapEight(c.clip.view, c.media.width, c.media.height, W, H));
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
    const s = snapView(clampView({ ...c.clip.view, zoom: z }), { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH });
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
