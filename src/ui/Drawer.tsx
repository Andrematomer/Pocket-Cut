import { useEffect, useRef, useState } from 'preact/hooks';
import { NO_GRADE } from '../layers.ts';
import { editText, set, setSolidColor, setSpeed, targets, updateClip, useStore, type Tool } from '../store.ts';
import { TEXT_FONTS, autoOutline } from '../text.ts';
import { MAX_SPEED, MIN_SPEED, clipDuration, fmtTime } from '../timeline.ts';
import type { Grade, MediaInfo } from '../types.ts';
import { Download, FontIcon, Gear, Help, Look, Mute, OutlineIcon, Sound, Speed, Swatch, TextIcon } from './icons.tsx';
import { Slider } from './Slider.tsx';
import { useSwap } from './swap.ts';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** the loudness each clip had before it was muted, so tapping the speaker brings it back */
const before = new Map<string, number>();

interface TabDef {
  key: Tool;
  name: string;
  icon: () => preact.JSX.Element;
}
const TABS: TabDef[] = [
  { key: 'text', name: 'Text', icon: TextIcon },
  { key: 'color', name: 'Color', icon: Swatch },
  { key: 'font', name: 'Font', icon: FontIcon },
  { key: 'outline', name: 'Outline', icon: OutlineIcon },
  { key: 'speed', name: 'Speed', icon: Speed },
  { key: 'sound', name: 'Sound', icon: Sound },
  { key: 'look', name: 'Look', icon: Look },
];

/** which tabs make sense for a clip of this media */
export function tabsFor(m: MediaInfo | undefined): Tool[] {
  if (!m) return [];
  if (m.text !== undefined) return ['text', 'color', 'font', 'outline', 'look'];
  if (m.solid !== undefined) return ['color', 'look'];
  if (m.kind === 'image') return ['look'];
  if (m.kind === 'audio') return ['speed', 'sound'];
  return m.hasAudio ? ['speed', 'sound', 'look'] : ['speed', 'look'];
}

/**
 * The strip of tabs under the timeline. Always visible with icons and names; tapping one raises its
 * drawer over the lower part of the timeline, tapping the open one (or anywhere outside) puts it away.
 */
export function TabBar() {
  const drawer = useStore((s) => s.drawer);
  const sheet = useStore((s) => s.sheet);
  const exporting = useStore((s) => s.exporting);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const multi = useStore((s) => s.multi);
  const aspect = useStore((s) => s.project.settings.aspect);
  const mediaOf = useStore((s) => s.project.media);
  const clips = useStore((s) => s.project.clips);
  // with several strips picked, only the tabs every one of them has are shown
  const picked = multi.length > 0 ? clips.filter((c) => multi.includes(c.id)) : clip ? [clip] : [];
  const tabs = picked.length === 0 ? [] : TABS.map((t) => t.key).filter((k) => picked.every((c) => tabsFor(mediaOf[c.mediaId]).includes(k)) && !(k === 'text' && picked.length > 1));
  const sig = picked.length === 0 ? 'project' : tabs.join() || 'none';
  const { shown, cls } = useSwap({ project: picked.length === 0, tabs }, sig);
  const openSheet = (name: 'help' | 'canvas' | 'settings' | 'export') => () => set({ sheet: sheet === name ? 'none' : name, drawer: null });
  if (shown.project) {
    // nothing selected: the tools of the whole project (they rise over the timeline like any other tool)
    const items: { name: 'help' | 'canvas' | 'settings' | 'export'; label: string; icon: preact.JSX.Element }[] = [
      { name: 'help', label: 'Help', icon: <Help /> },
      { name: 'canvas', label: `Ratio ${aspect}`, icon: <i class="canvas-ico" aria-hidden="true" /> },
      { name: 'settings', label: 'Settings', icon: <Gear /> },
      { name: 'export', label: 'Export', icon: <Download /> },
    ];
    return (
      <nav class={`tabbar ${cls}`} aria-label="Project tools">
        {items.map((it) => (
          <button key={it.name} class={`tab ${sheet === it.name ? 'on' : ''}`} disabled={exporting && it.name !== 'export'} aria-expanded={sheet === it.name} onClick={openSheet(it.name)}>
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <nav class={`tabbar ${cls}`} aria-label="Clip tools">
      {TABS.filter((t) => shown.tabs.includes(t.key)).map((t) => (
        <button key={t.key} class={`tab ${drawer === t.key ? 'on' : ''}`} aria-expanded={drawer === t.key} onClick={() => set({ drawer: drawer === t.key ? null : t.key, tool: t.key })}>
          <t.icon />
          <span>{t.name}</span>
        </button>
      ))}
    </nav>
  );
}

/** A name that resets its slider when tapped twice (as in DaVinci Resolve). */
function ResetLabel({ label, onReset }: { label: string; onReset: () => void }) {
  const last = useRef(0);
  return (
    <span
      class="dlabel"
      onPointerUp={() => {
        const now = performance.now();
        if (now - last.current < 380) {
          last.current = 0;
          onReset();
        } else last.current = now;
      }}
    >
      {label}
    </span>
  );
}

/** The system's own color picker: one swatch showing the current color. */
function ColorRow({ value, onPick, label }: { value: string; onPick: (c: string) => void; label: string }) {
  const timer = useRef(0);
  const [live, setLive] = useState(value);
  useEffect(() => setLive(value), [value]);
  const pick = (c: string) => {
    setLive(c);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onPick(c), 120);
  };
  return (
    <div class="color-row" role="group" aria-label={label}>
      <label class="swatch custom on" style={{ background: live }} aria-label={label}>
        <input type="color" value={live} onInput={(e) => pick((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <span class="num dim">{live.toUpperCase()}</span>
    </div>
  );
}

export { ColorRow };

function TextBox({ index, text }: { index: number; text: string }) {
  const [v, setV] = useState(text);
  const timer = useRef(0);
  return (
    <textarea
      class="name-field text-field"
      rows={3}
      value={v}
      placeholder="Type here"
      aria-label="Text"
      onInput={(e) => {
        const t = (e.currentTarget as HTMLTextAreaElement).value;
        setV(t);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void editText(index, { text: t.trim() ? t : ' ' }), 300);
      }}
    />
  );
}

/** The panel of the open tab. It sits over the timeline instead of pushing the rest of the screen up. */
export function Drawer() {
  const tool = useStore((s) => s.drawer);
  const index = useStore((s) => s.selected);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const media = useStore((s) => (s.project.clips[s.selected] ? s.project.media[s.project.clips[s.selected]!.mediaId] : undefined));
  const close = () => set({ drawer: null });
  const each = (fn: (i: number) => void) => (targets().length > 1 ? targets() : [index]).forEach(fn);
  // the panel stays for a moment after it is closed, so it can slide out
  const [last, setLast] = useState<Tool | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (tool) {
      setLast(tool);
      setLeaving(false);
      return;
    }
    if (!last) return;
    setLeaving(true);
    const id = window.setTimeout(() => (setLast(null), setLeaving(false)), 170);
    return () => clearTimeout(id);
  }, [tool]);
  const shown = tool ?? last;
  const sw = useSwap(shown, shown ?? '');

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // the selection moved to a clip this tab does not suit: show the first tab that does
  const ok = tabsFor(media);
  useEffect(() => {
    if (tool && clip && media && !ok.includes(tool)) set({ drawer: ok[0] ?? null });
  });

  if (!shown || !clip || !media || !ok.includes(shown)) return null;
  const tab = sw.shown ?? shown;
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
  const textColor = media.textColor ?? '#ffffff';
  const outlineColor = media.textOutline ?? autoOutline(textColor);
  const outlineWidth = media.textWidth ?? 14;

  const row = (label: string, value: string, reset: () => void, slider: preact.JSX.Element) => (
    <div class="drow">
      <ResetLabel label={label} onReset={reset} />
      {slider}
      <span class="dval num">{value}</span>
    </div>
  );
  const gradeRow = (label: string, key: keyof Grade) =>
    row(
      label,
      `${Math.round(grade[key] * 100)}`,
      () => setGrade({ [key]: 0 }),
      <Slider label={label} value={Math.round(grade[key] * 100)} min={-100} max={100} step={1} fineStep={0.5} snaps={[0]} snapPx={12} valueText={`${Math.round(grade[key] * 100)}`} onChange={(v) => setGrade({ [key]: Math.round(v) / 100 })} />,
    );

  return (
    <>
      {tool && <div class="drawer-scrim" onPointerDown={close} />}
      <div class={`drawer ${leaving ? 'out' : ''}`} role="region" aria-label={`${tab} options`}>
        <div class={sw.cls}>
        <div class="drawer-head">
          <strong>{media.text ? `“${media.name}”` : media.name || 'Clip'}</strong>
          <span class="num dim">{fmtTime(dur)}</span>
        </div>

        {tab === 'text' && (
          <section>
            <TextBox key={clip.id} index={index} text={media.text ?? ''} />
          </section>
        )}

        {tab === 'color' && (
          <section>
            {media.solid !== undefined ? (
              <ColorRow label="Color" value={media.solid} onPick={(c) => each((i) => void setSolidColor(i, c))} />
            ) : (
              <ColorRow label="Text color" value={textColor} onPick={(c) => each((i) => void editText(i, { color: c }))} />
            )}
          </section>
        )}

        {tab === 'font' && (
          <section>
            <div class="chips" role="group" aria-label="Font">
              {TEXT_FONTS.map((f) => (
                <button key={f.key} class={`chip ${f.key === (media.textFont ?? 'sans') ? 'on' : ''}`} style={{ fontFamily: f.css, fontWeight: f.weight }} aria-pressed={f.key === (media.textFont ?? 'sans')} onClick={() => each((i) => void editText(i, { font: f.key }))}>
                  {f.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {tab === 'outline' && (
          <section>
            {row('Thickness', `${outlineWidth}`, () => each((i) => void editText(i, { width: 14 })), <Slider label="Outline thickness" value={outlineWidth} min={0} max={40} step={1} fineStep={0.5} snaps={[0, 14]} snapPx={10} valueText={`${outlineWidth}`} onChange={(v) => each((i) => void editText(i, { width: Math.round(v) }))} />)}
            <ColorRow label="Outline color" value={outlineColor} onPick={(c) => each((i) => void editText(i, { outline: c }))} />
          </section>
        )}

        {tab === 'speed' && (
          <section>
            {row('Speed', `${clip.speed.toFixed(2).replace(/0$/, '')}×`, () => setSpeed(index, 1), <Slider label="Speed" value={clip.speed} min={MIN_SPEED} max={MAX_SPEED} log snaps={SPEEDS} snapPx={12} step={0.05} fineStep={0.01} valueText={`${clip.speed} times`} onChange={(v) => setSpeed(index, v)} />)}
            {media.hasAudio && (
              <div class="seg" role="group" aria-label="Pitch">
                <button class={clip.keepPitch ? 'on' : ''} aria-pressed={clip.keepPitch} onClick={() => updateClip(index, { keepPitch: true })}>
                  Keep pitch
                </button>
                <button class={!clip.keepPitch ? 'on' : ''} aria-pressed={!clip.keepPitch} onClick={() => updateClip(index, { keepPitch: false })}>
                  Follow speed
                </button>
              </div>
            )}
          </section>
        )}

        {tab === 'sound' && (
          <section class="sound">
            <button class={`speaker ${pct === 0 ? 'muted' : ''}`} onClick={toggleMute} aria-label={pct === 0 ? 'Unmute' : 'Mute'} aria-pressed={pct === 0}>
              {pct === 0 ? <Mute /> : <Sound />}
            </button>
            <ResetLabel label="Volume" onReset={() => setVol(100)} />
            <Slider label="Volume" value={pct} min={0} max={100} step={1} fineStep={0.5} snaps={[0, 100]} snapPx={14} valueText={pct === 0 ? 'muted' : `${pct} percent`} onChange={setVol} />
            <span class="num dval">{pct === 0 ? 'Muted' : `${pct}%`}</span>
          </section>
        )}

        {tab === 'look' && (
          <section>
            {row('Opacity', `${opacity}%`, () => updateClip(index, { opacity: undefined }), <Slider label="Opacity" value={opacity} min={0} max={100} step={1} fineStep={0.5} snaps={[100]} snapPx={14} valueText={`${opacity} percent`} onChange={(v) => updateClip(index, { opacity: v >= 99.5 ? undefined : Math.max(0, v) / 100 })} />)}
            {gradeRow('Brightness', 'brightness')}
            {gradeRow('Contrast', 'contrast')}
            {gradeRow('Color', 'saturation')}
            {gradeRow('Warmth', 'warmth')}
            <p class="hint">Tap a name twice to reset that slider.</p>
          </section>
        )}
        </div>
      </div>
    </>
  );
}
