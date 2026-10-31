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

function CropBox({ boxW, boxH }: { boxW: number; boxH: number }) {
  const project = useStore((s) => s.project);
  const selected = useStore((s) => s.selected);
  const clip = project.clips[selected]!;
  const media = project.media[clip.mediaId]!;
  const crop: Crop = clip.crop ?? FULL_CROP;
  const drag = useRef<{ mode: Corner | 'move'; x: number; y: number; crop: Crop } | null>(null);
  const r = rotatedSize(media.width, media.height, clip.rotation);

  const down = (mode: Corner | 'move') => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, crop };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / boxW;
    const dy = (e.clientY - d.y) / boxH;
    const next = d.mode === 'move' ? clampCrop({ ...d.crop, x: d.crop.x + dx, y: d.crop.y + dy }) : resizeCrop(d.crop, d.mode, dx, dy, clip.cropAspect, r.w, r.h);
    updateClip(selected, { crop: next });
  };
  const up = () => {
    drag.current = null;
  };

  const pct = (v: number) => `${v * 100}%`;
  return (
    <div class="cropper" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div class="crop-rect" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }} onPointerDown={down('move')}>
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
