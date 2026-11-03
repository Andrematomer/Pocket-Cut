import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { clampView, dragView, outputSize, pinchView, snapView, type Pt } from '../geometry.ts';
import { getState, set, splitAtPlayhead, toast, updateClip, useStore } from '../store.ts';
import { fmtTime, layout } from '../timeline.ts';
import type { View } from '../types.ts';
import { Pause, Play, Split } from './icons.tsx';

export function Preview() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const busy = useStore((s) => s.busy);
  const preparing = useStore((s) => s.preparing);
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
    const L = layout(project.clips);
    const sel = getState().selected;
    const t = Math.min(getState().playhead, L.total);
    const playheadClipStart = L.starts[sel] ?? 0;
    const inSel = t >= playheadClipStart - 1e-6 && t <= playheadClipStart + (L.durations[sel] ?? 0);
    void engine.showAt(inSel ? t : playheadClipStart).then(() => set({ playhead: engine.tl }));
  }, [idsKey, selected]);

  if (!clip || !media) return <div class="stage" ref={wrap} />;

  return (
    <div class="stage" ref={wrap}>
      <div class="frame" style={{ width: `${box.w}px`, height: `${box.h}px` }}>
        <canvas ref={canvas} style={{ width: `${box.w}px`, height: `${box.h}px` }} />
        {box.w > 0 && <Gestures boxW={box.w} boxH={box.h} />}
        {(busy || preparing) && <div class="overlay-note">{busy ?? 'Making a lighter copy for smooth preview…'}</div>}
      </div>
    </div>
  );
}


const fmtDeg = (d: number) => `${Math.round(d)}°`;

/**
 * Moves the picture on the canvas with the fingers: one finger drags, two fingers pinch to zoom and
 * twist to turn. Magnets pull to the center lines, quarter turns, "whole picture fits" and "fills".
 * While fingers are down the view is only drawn (never saved); it is saved when the last finger lifts.
 */
function Gestures({ boxW, boxH }: { boxW: number; boxH: number }) {
  const selected = useStore((s) => s.selected);
  const guideV = useRef<HTMLDivElement>(null);
  const guideH = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const pts = useRef(new Map<number, Pt>());
  const base = useRef<{ view: View; a: Pt; b: Pt | null; ids: number[] } | null>(null);
  const live = useRef<View | null>(null);
  const frame = useRef(0);

  const rel = (e: PointerEvent): Pt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left - boxW / 2, y: e.clientY - r.top - boxH / 2 };
  };
  const current = (): { clip: ReturnType<typeof getState>['project']['clips'][number]; media: NonNullable<ReturnType<typeof getState>['project']['media'][string]> } | null => {
    const st = getState();
    const clip = st.project.clips[st.selected];
    const media = clip && st.project.media[clip.mediaId];
    return clip && media ? { clip, media } : null;
  };
  const rebase = () => {
    const c = current();
    if (!c) return;
    const ids = [...pts.current.keys()].slice(0, 2);
    base.current = ids.length ? { view: live.current ?? c.clip.view, a: pts.current.get(ids[0]!)!, b: ids[1] !== undefined ? pts.current.get(ids[1])! : null, ids } : null;
  };
  const guides = (s: ReturnType<typeof snapView> | null) => {
    guideV.current?.classList.toggle('on', !!s?.x);
    guideH.current?.classList.toggle('on', !!s?.y);
    const b = badge.current;
    if (!b) return;
    const text = s ? (s.zoom === 'fit' ? 'Fit' : s.zoom === 'fill' ? 'Fill' : s.rot !== null ? fmtDeg(s.rot) : '') : '';
    b.textContent = text;
    b.classList.toggle('on', !!text);
  };
  const paint = () => {
    frame.current = 0;
    engine.draw();
  };

  const down = (e: PointerEvent) => {
    e.preventDefault();
    engine.pause();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, rel(e));
    const c = current();
    if (c && !live.current) live.current = c.clip.view;
    rebase();
  };
  const move = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, rel(e));
    const b = base.current;
    const c = current();
    if (!b || !c) return;
    const a1 = pts.current.get(b.ids[0]!)!;
    let v: View;
    if (b.b) v = pinchView(b.view, boxW, boxH, b.a, b.b, a1, pts.current.get(b.ids[1]!)!);
    else v = dragView(b.view, boxW, boxH, a1.x - b.a.x, a1.y - b.a.y);
    const s = snapView(clampView(v), { sw: c.media.width, sh: c.media.height, W: boxW, H: boxH });
    live.current = s.view;
    engine.live = { index: getState().selected, view: s.view };
    guides(s);
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  const up = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size > 0) {
      // a finger lifted or was added: carry on from where the picture is now
      rebase();
      return;
    }
    base.current = null;
    guides(null);
    const v = live.current;
    live.current = null;
    if (v) {
      updateClip(getState().selected, { view: v });
      engine.live = null;
      engine.draw();
    }
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
    <div class="gestures" key={selected} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <div class="guide v" ref={guideV} />
      <div class="guide h" ref={guideH} />
      <div class="gesture-badge num" ref={badge} />
    </div>
  );
}

export function Transport() {
  const playing = useStore((s) => s.playing);
  const playhead = useStore((s) => s.playhead);
  const clips = useStore((s) => s.project.clips);
  const total = layout(clips).total;

  const toggle = () => {
    if (playing) engine.pause();
    else void engine.play();
  };
  const cut = () => {
    if (!splitAtPlayhead()) toast('Move the position marker into a clip, away from its edges, to cut there.');
  };
  const scrub = (e: Event) => {
    const t = Number((e.currentTarget as HTMLInputElement).value);
    set({ playhead: t });
    void engine.showAt(t);
  };

  return (
    <div class="transport">
      <button class="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button class="cut" onClick={cut} aria-label="Cut the clip at the position marker">
        <Split />
      </button>
      <input class="scrub" type="range" min={0} max={Math.max(total, 0.01)} step={0.01} value={Math.min(playhead, total)} onInput={scrub} aria-label="Position" />
      <span class="time num">
        {fmtTime(playhead)} <small>/ {fmtTime(total)}</small>
      </span>
    </div>
  );
}
