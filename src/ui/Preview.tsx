import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { engine } from '../engine.ts';
import { FULL_CROP, clampCrop, outputSize, resizeCrop, rotatedSize } from '../geometry.ts';
import { getState, set, updateClip, useStore } from '../store.ts';
import { fmtTime, layout } from '../timeline.ts';
import type { Crop } from '../types.ts';
import { Pause, Play } from './icons.tsx';

export function Preview() {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const editingCrop = useStore((s) => s.tool === 'crop');
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [avail, setAvail] = useState({ w: 0, h: 0 });

  const clip = project.clips[selected];
  const media = clip && project.media[clip.mediaId];

  // aspect of what the canvas shows: the result, or (while cropping) the whole rotated frame
  let aspect = 9 / 16;
  if (clip && media) {
    if (editingCrop) {
      const r = rotatedSize(media.width, media.height, clip.rotation);
      aspect = r.w / r.h;
    } else {
      const o = outputSize(project);
      aspect = o.w / o.h;
    }
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

  // crop editing shows the whole frame
  useEffect(() => {
    engine.editCrop = editingCrop;
    engine.draw();
  }, [editingCrop]);

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
        {editingCrop && box.w > 0 && <CropBox boxW={box.w} boxH={box.h} />}
      </div>
    </div>
  );
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Crop box. While a finger is down the box is moved straight in the DOM (no store update, no
 * re-render, no canvas redraw), so it follows the finger smoothly. The result is saved on release.
 */
function CropBox({ boxW, boxH }: { boxW: number; boxH: number }) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const clip = project.clips[selected]!;
  const media = project.media[clip.mediaId]!;
  const crop: Crop = clip.crop ?? FULL_CROP;
  const drag = useRef<{ mode: Corner | 'move'; id: number; x: number; y: number; crop: Crop; live: Crop } | null>(null);
  const els = useRef<Record<'rect' | 't' | 'b' | 'l' | 'r', HTMLDivElement | null>>({ rect: null, t: null, b: null, l: null, r: null });
  const r = rotatedSize(media.width, media.height, clip.rotation);

  const paint = (c: Crop) => {
    const e = els.current;
    const x = c.x * boxW;
    const y = c.y * boxH;
    const w = c.w * boxW;
    const h = c.h * boxH;
    if (e.rect) e.rect.style.transform = `translate(${x}px, ${y}px)`, (e.rect.style.width = `${w}px`), (e.rect.style.height = `${h}px`);
    if (e.t) e.t.style.height = `${y}px`;
    if (e.b) e.b.style.height = `${Math.max(0, boxH - y - h)}px`;
    if (e.l) (e.l.style.top = `${y}px`), (e.l.style.height = `${h}px`), (e.l.style.width = `${x}px`);
    if (e.r) (e.r.style.top = `${y}px`), (e.r.style.height = `${h}px`), (e.r.style.width = `${Math.max(0, boxW - x - w)}px`);
  };

  const down = (mode: Corner | 'move') => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, id: e.pointerId, x: e.clientX, y: e.clientY, crop, live: crop };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = (e.clientX - d.x) / boxW;
    const dy = (e.clientY - d.y) / boxH;
    d.live = d.mode === 'move' ? clampCrop({ ...d.crop, x: d.crop.x + dx, y: d.crop.y + dy }) : resizeCrop(d.crop, d.mode, dx, dy, clip.cropAspect, r.w, r.h);
    paint(d.live);
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    updateClip(selected, { crop: d.live });
  };

  const px = (c: Crop) => ({ x: c.x * boxW, y: c.y * boxH, w: c.w * boxW, h: c.h * boxH });
  const o = px(crop);
  return (
    <div class="cropper" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div class="dim" ref={(n) => void (els.current.t = n)} style={{ left: '0px', top: '0px', width: `${boxW}px`, height: `${o.y}px` }} />
      <div class="dim" ref={(n) => void (els.current.b = n)} style={{ left: '0px', bottom: '0px', width: `${boxW}px`, height: `${Math.max(0, boxH - o.y - o.h)}px` }} />
      <div class="dim" ref={(n) => void (els.current.l = n)} style={{ left: '0px', top: `${o.y}px`, width: `${o.x}px`, height: `${o.h}px` }} />
      <div class="dim" ref={(n) => void (els.current.r = n)} style={{ right: '0px', top: `${o.y}px`, width: `${Math.max(0, boxW - o.x - o.w)}px`, height: `${o.h}px` }} />
      <div
        class="crop-rect"
        ref={(n) => void (els.current.rect = n)}
        style={{ left: '0px', top: '0px', transform: `translate(${o.x}px, ${o.y}px)`, width: `${o.w}px`, height: `${o.h}px` }}
        onPointerDown={down('move')}
      >
        <i class="grid" />
        {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => (
          <b key={c} class={`handle ${c}`} onPointerDown={down(c)} />
        ))}
      </div>
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
      <input class="scrub" type="range" min={0} max={Math.max(total, 0.01)} step={0.01} value={Math.min(playhead, total)} onInput={scrub} aria-label="Position" />
      <span class="time num">
        {fmtTime(playhead)} <small>/ {fmtTime(total)}</small>
      </span>
    </div>
  );
}
