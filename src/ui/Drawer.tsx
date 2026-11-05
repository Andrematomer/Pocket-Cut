import { useEffect } from 'preact/hooks';
import { engine } from '../engine.ts';
import { NO_GRADE } from '../layers.ts';
import { deleteClip, duplicateClip, set, setCrop, setSpeed, splitAtPlayhead, toast, updateClip, useStore, type Tool } from '../store.ts';
import { MAX_SPEED, MIN_SPEED, clipDuration, fmtTime } from '../timeline.ts';
import type { Grade } from '../types.ts';
import { Crop, Layers, Look, Mute, Sound, Speed, Split, Copy, Trash } from './icons.tsx';
import { Slider } from './Slider.tsx';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** the loudness each clip had before it was muted, so tapping the speaker brings it back */
const before = new Map<string, number>();

interface TabDef {
  key: Tool;
  name: string;
  icon: () => preact.JSX.Element;
}
const TABS: TabDef[] = [
  { key: 'speed', name: 'Speed', icon: Speed },
  { key: 'sound', name: 'Sound', icon: Sound },
  { key: 'look', name: 'Look', icon: Look },
  { key: 'clip', name: 'Clip', icon: Layers },
];

/** which tabs make sense for the selected clip */
function tabsFor(kind: string | undefined, hasSound: boolean): Tool[] {
  const out: Tool[] = [];
  if (kind !== 'image') out.push('speed');
  if (hasSound) out.push('sound');
  if (kind !== 'audio') out.push('look');
  out.push('clip');
  return out;
}

/**
 * The strip of tabs under the timeline. Always visible with icons and names; tapping one raises its
 * drawer over the lower half of the timeline, tapping the open one (or anywhere outside) puts it away.
 */
export function TabBar() {
  const drawer = useStore((s) => s.drawer);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const shown = tabsFor(media?.kind, !!media?.hasAudio);
  return (
    <nav class="tabbar" aria-label="Clip tools">
      {TABS.filter((t) => shown.includes(t.key)).map((t) => (
        <button
          key={t.key}
          class={`tab ${drawer === t.key ? 'on' : ''}`}
          disabled={!clip}
          aria-expanded={drawer === t.key}
          onClick={() => set({ drawer: drawer === t.key ? null : t.key, tool: t.key, gapMenu: false })}
        >
          <t.icon />
          <span>{t.name}</span>
        </button>
      ))}
    </nav>
  );
}

/** The panel of the open tab. It sits over the timeline instead of pushing the rest of the screen up. */
export function Drawer() {
  const tool = useStore((s) => s.drawer);
  const index = useStore((s) => s.selected);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const playhead = useStore((s) => s.playhead);
  const cropMode = useStore((s) => s.cropMode);
  const close = () => set({ drawer: null });

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // the selection moved to a clip this tab does not suit: show the first tab that does
  const kind = media?.kind;
  const ok = tabsFor(kind, !!media?.hasAudio);
  useEffect(() => {
    if (tool && clip && media && !ok.includes(tool)) set({ drawer: ok[0] ?? 'clip' });
  });

  if (!tool || !clip || !media || !ok.includes(tool)) return null;
  const dur = clipDuration(clip);
  const pct = Math.round(clip.volume * 100);
  const setVol = (v: number) => updateClip(index, { volume: Math.min(1, Math.max(0, v / 100)) });
  const toggleMute = () => {
    if (clip.volume > 0) {
      before.set(clip.id, clip.volume);
      updateClip(index, { volume: 0 });
    } else updateClip(index, { volume: before.get(clip.id) ?? 1 });
  };
  const grade: Grade = clip.grade ?? NO_GRADE;
  const setGrade = (patch: Partial<Grade>) => {
    const g = { ...grade, ...patch };
    updateClip(index, { grade: g.brightness || g.contrast || g.saturation || g.warmth ? g : undefined });
  };
  const opacity = Math.round((clip.opacity ?? 1) * 100);
  const inside = playhead > clip.at + 0.05 && playhead < clip.at + dur - 0.05;

  const gradeSlider = (label: string, key: keyof Grade) => (
    <Slider key={key} label={label} value={Math.round(grade[key] * 100)} min={-100} max={100} step={1} fineStep={0.5} snaps={[0]} snapPx={12} valueText={`${Math.round(grade[key] * 100)}`} onChange={(v) => setGrade({ [key]: Math.round(v) / 100 })} />
  );
  const row = (label: string, value: string, slider: preact.JSX.Element) => (
    <div class="drow">
      <span class="dlabel">{label}</span>
      {slider}
      <span class="dval num">{value}</span>
    </div>
  );

  return (
    <>
      <div class="drawer-scrim" onPointerDown={close} />
      <div class="drawer" role="region" aria-label={`${tool} options`}>
        <div class="drawer-head">
          <strong>{media.text ? `“${media.name}”` : media.name || 'Clip'}</strong>
          <span class="num dim">{fmtTime(dur)}</span>
        </div>

        {tool === 'speed' && (
          <section>
            {row('Speed', `${clip.speed.toFixed(2).replace(/0$/, '')}×`, <Slider label="Speed" value={clip.speed} min={MIN_SPEED} max={MAX_SPEED} log snaps={SPEEDS} snapPx={12} step={0.05} fineStep={0.01} valueText={`${clip.speed} times`} onChange={(v) => setSpeed(index, v)} />)}
            {media.hasAudio && (
              <button class="btn pitch-btn" onClick={() => updateClip(index, { keepPitch: !clip.keepPitch })}>
                {clip.keepPitch ? 'Pitch kept' : 'Pitch follows speed'}
              </button>
            )}
          </section>
        )}

        {tool === 'sound' && (
          <section class="sound">
            <button class={`speaker ${pct === 0 ? 'muted' : ''}`} onClick={toggleMute} aria-label={pct === 0 ? 'Unmute' : 'Mute'} aria-pressed={pct === 0}>
              {pct === 0 ? <Mute /> : <Sound />}
            </button>
            <Slider label="Volume" value={pct} min={0} max={100} step={1} fineStep={0.5} snaps={[0, 100]} snapPx={14} valueText={pct === 0 ? 'muted' : `${pct} percent`} onChange={setVol} />
            <span class="num dval">{pct === 0 ? 'Muted' : `${pct}%`}</span>
          </section>
        )}

        {tool === 'look' && (
          <section>
            {row('Opacity', `${opacity}%`, <Slider label="Opacity" value={opacity} min={0} max={100} step={1} fineStep={0.5} snaps={[100]} snapPx={14} valueText={`${opacity} percent`} onChange={(v) => updateClip(index, { opacity: v >= 99.5 ? undefined : Math.max(0, v) / 100 })} />)}
            {row('Brightness', `${Math.round(grade.brightness * 100)}`, gradeSlider('Brightness', 'brightness'))}
            {row('Contrast', `${Math.round(grade.contrast * 100)}`, gradeSlider('Contrast', 'contrast'))}
            {row('Color', `${Math.round(grade.saturation * 100)}`, gradeSlider('Color', 'saturation'))}
            {row('Warmth', `${Math.round(grade.warmth * 100)}`, gradeSlider('Warmth', 'warmth'))}
            <div class="drawer-actions">
              <button class={`btn ${cropMode ? 'on' : ''}`} onClick={() => set({ cropMode: !cropMode, drawer: null })}>
                <Crop /> Crop
              </button>
              {clip.crop && (
                <button class="btn" onClick={() => setCrop(index, undefined)}>
                  Reset crop
                </button>
              )}
              {(clip.grade || clip.opacity !== undefined) && (
                <button class="btn" onClick={() => updateClip(index, { grade: undefined, opacity: undefined })}>
                  Reset look
                </button>
              )}
            </div>
          </section>
        )}

        {tool === 'clip' && (
          <div class="drawer-actions">
            {inside && (
              <button
                class="btn"
                onClick={() => {
                  if (splitAtPlayhead()) close();
                  else toast('Move the yellow line into this clip, away from its edges, to cut there.');
                }}
              >
                <Split /> Split here
              </button>
            )}
            {!inside && <p class="hint grow">Scroll the timeline so the yellow line is inside this clip to split it there.</p>}
            {media.text && (
              <button class="btn" onClick={() => set({ drawer: null, sheet: 'text', textEdit: index })}>
                Aa Edit text
              </button>
            )}
            {kind !== 'audio' && (
              <button class="btn" onClick={() => set({ cropMode: !cropMode, drawer: null })}>
                <Crop /> Crop
              </button>
            )}
            <button
              class="btn"
              onClick={() => {
                engine.pause();
                duplicateClip(index);
                close();
              }}
            >
              <Copy /> Duplicate
            </button>
            <button class="btn danger" onClick={() => deleteClip(index)}>
              <Trash /> Delete
            </button>
          </div>
        )}
      </div>
    </>
  );
}
