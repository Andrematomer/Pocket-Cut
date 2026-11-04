import { useEffect } from 'preact/hooks';
import { engine } from '../engine.ts';
import { deleteClip, duplicateClip, set, setSpeed, splitAtPlayhead, toast, updateClip, useStore } from '../store.ts';
import { MAX_SPEED, MIN_SPEED, clipDuration, fmtTime } from '../timeline.ts';
import { Close, Copy, Mute, Sound, Split, Trash } from './icons.tsx';
import { Slider } from './Slider.tsx';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** the loudness each clip had before it was muted, so tapping the speaker brings it back */
const before = new Map<string, number>();

/**
 * The floating window of the selected clip: speed, sound, and the actions. Opens when the selected
 * strip is tapped again, or when a strip is held and put back without moving it.
 */
export function ClipPopup() {
  const index = useStore((s) => s.selected);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const playhead = useStore((s) => s.playhead);
  const close = () => set({ popup: false });

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  if (!clip || !media) return null;
  const image = media.kind === 'image';
  const hasSound = media.hasAudio;
  const dur = clipDuration(clip);
  const inside = playhead > clip.at + 0.05 && playhead < clip.at + dur - 0.05;
  const pct = Math.round(clip.volume * 100);
  const setVol = (v: number) => updateClip(index, { volume: Math.min(1, Math.max(0, v / 100)) });
  const toggleMute = () => {
    if (clip.volume > 0) {
      before.set(clip.id, clip.volume);
      updateClip(index, { volume: 0 });
    } else updateClip(index, { volume: before.get(clip.id) ?? 1 });
  };

  return (
    <div class="popup-scrim" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div class="popup" role="dialog" aria-label="Clip options">
        <header>
          <strong>{media.text ? `“${media.name}”` : media.name || 'Clip'}</strong>
          <span class="num popup-len">{fmtTime(dur)}</span>
          <button class="icon" onClick={close} aria-label="Close">
            <Close />
          </button>
        </header>

        {!image && (
          <section>
            <Slider label="Speed" value={clip.speed} min={MIN_SPEED} max={MAX_SPEED} log snaps={SPEEDS} snapPx={12} step={0.05} fineStep={0.01} valueText={`${clip.speed} times`} onChange={(v) => setSpeed(index, v)} />
            <div class="popup-line num">
              <span>{clip.speed.toFixed(2).replace(/0$/, '')}×</span>
              {hasSound && (
                <button class="pitch" onClick={() => updateClip(index, { keepPitch: !clip.keepPitch })}>
                  {clip.keepPitch ? 'Pitch kept' : 'Pitch follows speed'}
                </button>
              )}
            </div>
          </section>
        )}

        {hasSound && (
          <section class="sound">
            <button class={`speaker ${pct === 0 ? 'muted' : ''}`} onClick={toggleMute} aria-label={pct === 0 ? 'Unmute' : 'Mute'} aria-pressed={pct === 0}>
              {pct === 0 ? <Mute /> : <Sound />}
            </button>
            <Slider label="Volume" value={pct} min={0} max={100} step={1} fineStep={0.5} snaps={[0, 100]} snapPx={14} valueText={pct === 0 ? 'muted' : `${pct} percent`} onChange={setVol} />
            <span class="num vol">{pct === 0 ? 'Muted' : `${pct}%`}</span>
          </section>
        )}

        <div class="popup-actions">
          {inside && (
            <button
              class="btn"
              onClick={() => {
                if (splitAtPlayhead()) set({ popup: false });
                else toast('Move the position marker into this clip, away from its edges, to cut there.');
              }}
            >
              <Split /> Split here
            </button>
          )}
          {media.text && (
            <button class="btn" onClick={() => set({ popup: false, sheet: 'text', textEdit: index })}>
              Aa Edit text
            </button>
          )}
          <button
            class="btn"
            onClick={() => {
              engine.pause();
              duplicateClip(index);
              set({ popup: false });
            }}
          >
            <Copy /> Duplicate
          </button>
          <button class="btn danger" onClick={() => deleteClip(index)}>
            <Trash /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
