import { useRef } from 'preact/hooks';
import { thumbUrl } from '../media.ts';
import { set, useStore } from '../store.ts';
import { clipDuration, fmtTime } from '../timeline.ts';
import { engine } from '../engine.ts';
import { PickLabel } from './Picker.tsx';
import { Plus } from './icons.tsx';

const HOLD_MS = 500;

export function Strip() {
  const clips = useStore((s) => s.project.clips);
  const selected = useStore((s) => s.selected);
  const press = useRef<{ timer: number; fired: boolean; x: number; y: number } | null>(null);

  const start = (i: number) => (e: PointerEvent) => {
    const p = { timer: 0, fired: false, x: e.clientX, y: e.clientY };
    press.current = p;
    p.timer = window.setTimeout(() => {
      p.fired = true;
      engine.pause();
      set({ selected: i, sheet: 'clip' });
      try {
        navigator.vibrate?.(10);
      } catch {
        /* not supported */
      }
    }, HOLD_MS);
  };
  const wobble = (e: PointerEvent) => {
    const p = press.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) clearTimeout(p.timer);
  };
  const end = () => {
    if (press.current) clearTimeout(press.current.timer);
  };

  return (
    <div class="strip" role="listbox" aria-label="Clips">
      {clips.map((c, i) => {
        const url = thumbUrl(c.mediaId);
        return (
          <button
            key={c.id}
            role="option"
            aria-selected={i === selected}
            class={`tile ${i === selected ? 'on' : ''}`}
            onPointerDown={start(i)}
            onPointerMove={wobble}
            onPointerUp={end}
            onPointerCancel={end}
            onContextMenu={(e) => e.preventDefault()}
            onClick={() => {
              if (press.current?.fired) {
                press.current.fired = false; // the long press already opened the menu
                return;
              }
              engine.pause();
              set({ selected: i });
            }}
          >
            <span class="thumb">{url && <img src={url} alt="" draggable={false} style={{ transform: `rotate(${Math.round(c.view.rot / 90) * 90}deg)` }} />}</span>
            <span class="dur num">{fmtTime(clipDuration(c))}</span>
            {c.speed !== 1 && <span class="badge">{c.speed}×</span>}
          </button>
        );
      })}
      <PickLabel class="tile add" label="Add videos or pictures">
        <Plus />
      </PickLabel>
    </div>
  );
}
