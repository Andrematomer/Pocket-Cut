import { useRef, useState } from 'preact/hooks';

const HOLD_MS = 450;
const JITTER = 10;
const FINE = 0.1;
const GRAB = 32; // px: a finger this close to the thumb grabs it instead of jumping the thumb

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** values the slider is drawn with ticks for and is pulled towards */
  snaps?: readonly number[];
  /** true: only the snap values can be chosen (until the thumb is held for fine control) */
  snapAlways?: boolean;
  /** how close (px) a value has to be to a snap value to be pulled to it */
  snapPx?: number;
  /** granularity of free values */
  step?: number;
  /** granularity in fine mode */
  fineStep?: number;
  log?: boolean;
  label: string;
  valueText?: string;
}

/**
 * A slider made for thumbs: a 48 px tall touch area, optional snap points, and a hidden precision mode:
 * press and hold the thumb still, then slide, and the thumb moves a tenth as far as the finger with
 * snapping off (the same trick as the trim handles).
 */
export function Slider(p: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const [fine, setFine] = useState(false);
  const drag = useRef<{ id: number; x0: number; last: number; offset: number; anchorX: number; anchorF: number; wobbled: boolean; fine: boolean; timer: number } | null>(null);

  const toFrac = (v: number) => (p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min));
  const fromFrac = (f: number) => {
    const c = Math.min(1, Math.max(0, f));
    return p.log ? p.min * Math.pow(p.max / p.min, c) : p.min + c * (p.max - p.min);
  };
  const round = (v: number, step: number) => Math.min(p.max, Math.max(p.min, Math.round(v / step) * step));
  const width = () => track.current!.getBoundingClientRect().width;

  const pick = (f: number, fineMode: boolean): number => {
    const raw = fromFrac(f);
    if (fineMode) return round(raw, p.fineStep ?? (p.step ?? 1) / 10);
    const snaps = p.snaps;
    if (snaps && snaps.length) {
      let best = snaps[0]!;
      for (const s of snaps) if (Math.abs(toFrac(s) - f) < Math.abs(toFrac(best) - f)) best = s;
      if (p.snapAlways || Math.abs(toFrac(best) - f) * width() <= (p.snapPx ?? 14)) return best;
    }
    return round(raw, p.step ?? 1);
  };
  const fracAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return (clientX - r.left) / r.width;
  };
  const emit = (v: number) => v !== latest.current.value && latest.current.onChange(v);

  const latest = useRef(p);
  latest.current = p;

  const down = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = track.current!.getBoundingClientRect();
    const f0 = toFrac(p.value);
    const grabbed = Math.abs(e.clientX - (r.left + f0 * r.width)) <= GRAB;
    const d = { id: e.pointerId, x0: e.clientX, last: e.clientX, offset: grabbed ? f0 - fracAt(e.clientX) : 0, anchorX: e.clientX, anchorF: f0, wobbled: false, fine: false, timer: 0 };
    drag.current = d;
    if (!grabbed) emit(pick(fracAt(e.clientX), false)); // a tap jumps the thumb to the finger
    d.timer = window.setTimeout(() => {
      // held still: switch to fine control from where the thumb is now
      if (drag.current !== d || d.wobbled) return;
      d.fine = true;
      d.anchorX = d.last;
      d.anchorF = toFrac(latest.current.value);
      setFine(true);
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    d.last = e.clientX;
    if (!d.fine && Math.abs(e.clientX - d.x0) > JITTER) {
      d.wobbled = true;
      clearTimeout(d.timer);
    }
    if (d.fine) emit(pick(d.anchorF + ((e.clientX - d.anchorX) / width()) * FINE, true));
    else if (d.wobbled) emit(pick(fracAt(e.clientX) + d.offset, false));
  };
  const up = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    clearTimeout(d.timer);
    drag.current = null;
    setFine(false);
  };
  const key = (e: KeyboardEvent) => {
    const step = p.step ?? 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), emit(round(p.value + step, step)));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), emit(round(p.value - step, step)));
  };

  const f = Math.min(1, Math.max(0, toFrac(p.value)));
  return (
    <div
      class={`sl ${fine ? 'fine' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={p.label}
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      aria-valuenow={p.value}
      aria-valuetext={p.valueText}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div class="sl-track" ref={track}>
        <div class="sl-rail" />
        <div class="sl-fill" style={{ width: `${f * 100}%` }} />
        {p.snaps?.map((s) => (
          <i key={s} class="sl-tick" style={{ left: `${Math.min(1, Math.max(0, toFrac(s))) * 100}%` }} />
        ))}
        <div class="sl-thumb" style={{ left: `${f * 100}%` }} />
        {fine && <div class="sl-fine" style={{ left: `${f * 100}%` }}>FINE</div>}
      </div>
    </div>
  );
}
