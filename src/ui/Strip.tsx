import { pickVideos } from '../files.ts';
import { thumbUrl } from '../media.ts';
import { set, useStore } from '../store.ts';
import { clipDuration, fmtTime } from '../timeline.ts';
import { engine } from '../engine.ts';
import { Plus } from './icons.tsx';

export function Strip() {
  const clips = useStore((s) => s.project.clips);
  const selected = useStore((s) => s.selected);

  return (
    <div class="strip" role="listbox" aria-label="Clips">
      {clips.map((c, i) => {
        const url = thumbUrl(c.mediaId);
        const turned = c.rotation === 90 || c.rotation === 270;
        return (
          <button
            key={c.id}
            role="option"
            aria-selected={i === selected}
            class={`tile ${i === selected ? 'on' : ''}`}
            onClick={() => {
              engine.pause();
              set({ selected: i });
            }}
          >
            <span class="thumb">{url && <img src={url} alt="" style={{ transform: `rotate(${c.rotation}deg) ${turned ? 'scale(1.35)' : ''}` }} />}</span>
            <span class="dur num">{fmtTime(clipDuration(c))}</span>
            {c.speed !== 1 && <span class="badge">{c.speed}×</span>}
          </button>
        );
      })}
      <button class="tile add" onClick={pickVideos} aria-label="Add videos">
        <Plus />
      </button>
    </div>
  );
}
