import { useEffect, useRef, useState } from 'preact/hooks';
import { thumbUrl } from '../media.ts';
import { reorderClip, set, useStore } from '../store.ts';
import { clipDuration, fmtTime } from '../timeline.ts';
import { engine } from '../engine.ts';
import { PickLabel } from './Picker.tsx';
import { Pie } from './Pie.tsx';
import { Plus } from './icons.tsx';

const HOLD_MS = 350; // hold a thumbnail this long (without moving) to pick it up
const WOBBLE = 10;
const EDGE = 44; // px from the strip's edge where dragging starts to scroll it

interface Drag {
  from: number;
  to: number;
  dx: number;
}

/**
 * The clips. Tap selects. Hold a thumbnail until it lifts, then drag it left or right to reorder
 * (the strip scrolls by itself near its edges). Moving the finger before the hold completes just
 * scrolls the strip as usual.
 */
export function Strip() {
  const clips = useStore((s) => s.project.clips);
  const selected = useStore((s) => s.selected);
  const progress = useStore((s) => s.proxyProgress);
  const [drag, setDrag] = useState<Drag | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: number; i: number; x0: number; y0: number; x: number; timer: number; active: boolean; scroll0: number; pitch: number; left0: number; raf: number } | null>(null);
  const swallow = useRef(false);

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
        if (commit && d && d.to !== d.from) reorderClip(d.from, d.to);
        return null;
      });
    }
  };

  // while a tile is picked up the strip must not scroll under the finger: only a non-passive touchmove can stop that
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (st.current?.active) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  const update = () => {
    const s = st.current;
    const el = strip.current;
    if (!s || !s.active || !el) return;
    const r = el.getBoundingClientRect();
    // auto-scroll when the finger is near an edge
    let v = 0;
    if (s.x < r.left + EDGE) v = -Math.ceil(((r.left + EDGE - s.x) / EDGE) * 12);
    else if (s.x > r.right - EDGE) v = Math.ceil(((s.x - (r.right - EDGE)) / EDGE) * 12);
    if (v) el.scrollLeft += v;
    const dx = s.x - s.x0 + (el.scrollLeft - s.scroll0);
    const n = clips.length;
    const to = Math.max(0, Math.min(n - 1, Math.round(s.i + dx / s.pitch)));
    setDrag({ from: s.i, to, dx });
    s.raf = requestAnimationFrame(update);
  };

  const down = (i: number) => (e: PointerEvent) => {
    if (st.current) finish(false);
    const el = strip.current;
    if (!el || clips.length < 2) return;
    const tiles = el.querySelectorAll<HTMLElement>('.tile:not(.add)');
    const pitch = tiles.length > 1 ? tiles[1]!.offsetLeft - tiles[0]!.offsetLeft : 64;
    const target = e.currentTarget as HTMLElement;
    const s = { id: e.pointerId, i, x0: e.clientX, y0: e.clientY, x: e.clientX, timer: 0, active: false, scroll0: el.scrollLeft, pitch, left0: 0, raf: 0 };
    st.current = s;
    s.timer = window.setTimeout(() => {
      s.active = true;
      s.scroll0 = el.scrollLeft;
      s.x0 = s.x;
      engine.pause();
      set({ selected: i });
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
      setDrag({ from: i, to: i, dx: 0 });
      s.raf = requestAnimationFrame(update);
    }, HOLD_MS);
  };
  const move = (e: PointerEvent) => {
    const s = st.current;
    if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX;
    if (!s.active && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > WOBBLE) {
      clearTimeout(s.timer); // a scroll, not a pick-up
      st.current = null;
    }
  };
  const up = (e: PointerEvent) => {
    const s = st.current;
    if (s && e.pointerId === s.id) finish(e.type === 'pointerup');
  };

  return (
    <div class={`strip ${drag ? 'dragging' : ''}`} role="listbox" aria-label="Clips" ref={strip}>
      {clips.map((c, i) => {
        const url = thumbUrl(c.mediaId);
        const p = progress[c.mediaId];
        let shift = 0;
        let cls = '';
        if (drag) {
          const pitch = st.current?.pitch ?? 64;
          if (i === drag.from) (shift = drag.dx), (cls = 'lifted');
          else if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -pitch;
          else if (drag.from > drag.to && i < drag.from && i >= drag.to) shift = pitch;
        }
        return (
          <button
            key={c.id}
            role="option"
            aria-selected={i === selected}
            class={`tile ${i === selected ? 'on' : ''} ${cls}`}
            style={shift ? { transform: `translateX(${shift}px)${cls ? ' scale(1.08)' : ''}` } : undefined}
            onPointerDown={down(i)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (swallow.current) return;
              engine.pause();
              set({ selected: i });
            }}
          >
            <span class="thumb">{url && <span class="thumb-img" style={{ backgroundImage: `url("${url}")`, transform: `rotate(${Math.round(c.view.rot / 90) * 90}deg)` }} />}</span>
            <span class="dur num">{fmtTime(clipDuration(c))}</span>
            {c.speed !== 1 && <span class="badge">{c.speed}×</span>}
            {p !== undefined && (
              <span class="tile-pie" title="Making a lighter copy for the preview">
                <Pie value={p} size={18} />
              </span>
            )}
          </button>
        );
      })}
      <PickLabel class="tile add" label="Add videos or pictures">
        <Plus />
      </PickLabel>
    </div>
  );
}
