import { useEffect, useRef, useState } from 'preact/hooks';
import { ASPECT_VALUE, IDENTITY_VIEW, baseScale, fillZoom, nearestAspect, normAngle, outputSize } from './geometry.ts';
import { autoOutline, renderSolid, renderText } from './text.ts';
import { IMAGE_MAX_SECONDS, decodeImage, dropAllMedia, isAudioFile, isImageFile, probeAudio, mediaBlob, newId, probeImage, probeVideo, registerMedia, UnsupportedMediaError } from './media.ts';
import { setAwakeMode } from './wake.ts';
import { computePeaks } from './wave.ts';
import { onProxyProgress, onProxyWork, queueProxy, requeueAllProxies, setProxyOrder } from './proxy.ts';
import { clearSaved, loadSaved, requestPersistence, saveMedia, saveProject } from './persist.ts';
import { activeAt, clipDuration, clipEnd, endOfTrack, freeTrack, settleAt, MAX_SPEED, MIN_CLIP, MIN_SPEED, removeGap as removeGapFrom, totalOf, type Gap } from './timeline.ts';
import { DEFAULT_SETTINGS, emptyProject, type Clip, type ExportSettings, type MediaInfo, type Project } from './types.ts';

export type Tool = 'speed' | 'sound' | 'look' | 'clip' | 'text' | 'color' | 'font' | 'outline';
export type Sheet = 'none' | 'export' | 'settings' | 'canvas' | 'help';

export interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

export interface State {
  project: Project;
  selected: number;
  tool: Tool;
  /** timeline seconds */
  playhead: number;
  playing: boolean;
  busy: string | null;
  toast: Toast | null;
  sheet: Sheet;
  ready: boolean;
  /** a small preview copy is being made in the background */
  preparing: boolean;
  /** the tab drawer that is raised over the timeline, or null when only the tab bar shows */
  drawer: Tool | null;
  /** an empty stretch picked on the timeline (red box with a trash icon) */
  gap: Gap | null;
  /** the selected strip shows its trim handles */
  handles: boolean;
  /** the crop handles are shown on the preview */
  boxMode: boolean;
  /** the text clip being edited (index), or null when a new text is being made */
  textEdit: number | null;
  /** 0..1 per sound key while a clip's sound is being prepared for the preview */
  bakeProgress: Record<string, number>;
  /** loudness outlines of audio files, by media id */
  waves: Record<string, Uint8Array>;
  /** 0..1 per media id while its preview copy is waiting or being made */
  proxyProgress: Record<string, number>;
  /** settings of the app itself (not of one project) */
  prefs: AppPrefs;
  canUndo: boolean;
  canRedo: boolean;
}

export interface AppPrefs {
  /** how long a picture shows by default, seconds */
  imageSeconds: number;
  /** long side of the small preview copy, pixels */
  previewLong: number;
  /** keep the screen on: always, only while exporting / making preview copies, or never */
  awake: 'on' | 'work' | 'off';
  /** what playback does at the end of the timeline */
  onEnd: 'pause' | 'stop' | 'loop' | 'return';
  /** height of the strips on the timeline, 1 = normal (used when rowAuto is off) */
  rowScale: number;
  /** strips are sized so every shown lane fits */
  rowAuto: boolean;
}

export const DEFAULT_PREFS: AppPrefs = { imageSeconds: 5, previewLong: 240, awake: 'work', onEnd: 'pause', rowScale: 1, rowAuto: true };

function loadAppPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem('pocket-cut-nla:app-settings');
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<AppPrefs>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_PREFS };
}

let state: State = {
  project: freshProject(),
  selected: -1,
  tool: 'speed',
  playhead: 0,
  playing: false,
  busy: null,
  toast: null,
  sheet: 'none',
  ready: false,
  preparing: false,
  drawer: null,
  gap: null,
  handles: false,
  boxMode: false,
  textEdit: null,
  proxyProgress: {},
  bakeProgress: {},
  waves: {},
  prefs: loadAppPrefs(),
  canUndo: false,
  canRedo: false,
};

const subs = new Set<() => void>();
export const getState = (): State => state;

export function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function useStore<T>(select: (s: State) => T): T {
  const ref = useRef(select);
  ref.current = select;
  const [value, setValue] = useState(() => select(state));
  useEffect(() => {
    const f = () => setValue(() => ref.current(state));
    subs.add(f);
    f();
    return () => void subs.delete(f);
  }, []);
  return value;
}

let toastTimer = 0;
export function toast(text: string, action?: Toast['action'], ms = 5000): void {
  set({ toast: { text, action } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), ms);
}

// ---------- remembered export settings ----------

/** The export settings the person used last, or the defaults. Never throws (storage can be blocked). */
export function loadPrefs(): ExportSettings {
  try {
    const raw = localStorage.getItem('pocket-cut-nla:export-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ExportSettings>) };
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function savePrefs(s: ExportSettings): void {
  try {
    localStorage.setItem('pocket-cut-nla:export-settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function freshProject(): Project {
  return { ...emptyProject(), settings: loadPrefs() };
}

// ---------- project edits ----------

interface Snapshot {
  clips: Clip[];
  media: Project['media'];
}
const past: Snapshot[] = [];
const future: Snapshot[] = [];
let lastKey = '';
let lastAt = 0;
const HISTORY_MAX = 60;

const snap = (p: Project): Snapshot => ({ clips: p.clips, media: p.media });
const flags = () => ({ canUndo: past.length > 0, canRedo: future.length > 0 });

/** Every media file that undo or redo could bring back; its stored copy must not be pruned. */
export function mediaInHistory(): Set<string> {
  const ids = new Set<string>();
  for (const s of [...past, ...future]) for (const c of s.clips) ids.add(c.mediaId);
  return ids;
}

/**
 * Applies a change to the project. Changes to clips go into the undo history; a run of changes of the
 * same kind (dragging a slider, moving a picture) within a moment counts as one step.
 */
function edit(fn: (p: Project) => Project, opts: { key?: string; history?: boolean } = {}): void {
  const before = state.project;
  const project = { ...fn(before), updated: Date.now() };
  const selected = Math.min(state.selected, project.clips.length - 1);
  if (opts.history !== false && project.clips !== before.clips) {
    const now = Date.now();
    const merge = opts.key !== undefined && opts.key === lastKey && now - lastAt < 700;
    if (!merge) {
      past.push(snap(before));
      if (past.length > HISTORY_MAX) past.shift();
      future.length = 0;
    }
    lastKey = opts.key ?? '';
    lastAt = now;
  }
  set({ project, selected, playhead: Math.min(state.playhead, totalOf(project.clips)), ...flags() });
}

function restoreSnapshot(s: Snapshot): void {
  const project = { ...state.project, clips: s.clips, media: s.media, updated: Date.now() };
  const selected = Math.min(state.selected, project.clips.length - 1);
  lastKey = '';
  set({ project, selected, playhead: Math.min(state.playhead, totalOf(project.clips)), ...flags() });
}

export function undo(): void {
  const s = past.pop();
  if (!s) return;
  future.push(snap(state.project));
  restoreSnapshot(s);
}

export function redo(): void {
  const s = future.pop();
  if (!s) return;
  past.push(snap(state.project));
  restoreSnapshot(s);
}

function clearHistory(): void {
  past.length = 0;
  future.length = 0;
  lastKey = '';
  set(flags());
}

export function setPrefs(patch: Partial<AppPrefs>): void {
  const prefs = { ...state.prefs, ...patch };
  set({ prefs });
  setAwakeMode(prefs.awake);
  try {
    localStorage.setItem('pocket-cut-nla:app-settings', JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  if (patch.previewLong !== undefined) requeueAllProxies(state.project.media);
}

export function updateClip(index: number, patch: Partial<Clip>): void {
  edit((p) => ({ ...p, clips: p.clips.map((c, i) => (i === index ? { ...c, ...patch } : c)) }), { key: `${index}:${Object.keys(patch).join()}` });
}

export function setSpeed(index: number, speed: number): void {
  updateClip(index, { speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100)) });
}

/** Turns the clip a quarter turn clockwise about the middle of the canvas. */
export function quarterTurn(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  const rot = normAngle(Math.round(c.view.rot / 90) * 90 + 90);
  updateClip(index, { view: { ...c.view, rot } });
}

export function resetView(index: number): void {
  updateClip(index, { view: { ...IDENTITY_VIEW } });
}

export function setTrim(index: number, start: number, end: number): void {
  const c = state.project.clips[index];
  const m = c && state.project.media[c.mediaId];
  if (!c || !m) return;
  const s = Math.max(0, Math.min(start, m.duration - MIN_CLIP));
  const e = Math.min(m.duration, Math.max(end, s + MIN_CLIP));
  updateClip(index, { start: s, end: e });
}

/** Moves a clip on the timeline: new start time and lane. */
export function moveClipTo(index: number, at: number, track: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  const when = Math.max(0, Math.round(at * 100) / 100);
  // dropped on top of another strip: it goes to the next free lane instead
  const others = state.project.clips.filter((_, i) => i !== index);
  const dur = clipDuration(c);
  const flush = settleAt(others, at, dur, track);
  const next = { at: flush ?? when, track: freeTrack(others, flush ?? when, dur, track) };
  if (next.at === c.at && next.track === c.track) return;
  edit((p) => ({ ...p, clips: p.clips.map((x, i) => (i === index ? { ...x, ...next } : x)) }), { key: `move:${index}` });
}

export function deselect(): void {
  if (state.selected < 0 && !state.gap && !state.drawer) return;
  set({ selected: -1, gap: null, handles: false, boxMode: false, drawer: null });
}

/** Selects a clip and brings the position marker into it, so it shows in the preview. */
export function selectClip(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  const inside = state.playhead >= c.at - 1e-6 && state.playhead < clipEnd(c);
  set({ selected: index, playhead: inside ? state.playhead : c.at, gap: null, handles: state.selected === index ? state.handles : false, boxMode: state.selected === index ? state.boxMode : false });
}

export function duplicateClip(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  edit((p) => ({ ...p, clips: [...p.clips, { ...c, id: newId(), at: clipEnd(c), track: freeTrack(p.clips, clipEnd(c), clipDuration(c), c.track) }] }));
  set({ selected: state.project.clips.length - 1 });
}

export function deleteClip(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  // the file stays in memory and storage while undo could still bring the clip back.
  // Later clips close up exactly like when a gap is removed, with the same lane hopping.
  const gap = { track: c.track, from: c.at, to: clipEnd(c) };
  edit((p) => ({ ...p, clips: removeGapFrom(p.clips.filter((_, i) => i !== index), gap) }));
  set({ drawer: null, boxMode: false, handles: false, selected: -1, gap: null });
}

/** The look the last text was made with: the next new text starts from it. */
export interface TextStyle {
  color: string;
  font: string;
  outline: string;
  width: number;
}
export function loadTextStyle(): TextStyle {
  const d: TextStyle = { color: '#ffffff', font: 'sans', outline: '#000000', width: 14 };
  try {
    const raw = localStorage.getItem('pocket-cut-nla:text-style');
    if (raw) {
      const o = JSON.parse(raw) as Partial<TextStyle>;
      return { color: typeof o.color === 'string' ? o.color : d.color, font: typeof o.font === 'string' ? o.font : d.font, outline: typeof o.outline === 'string' ? o.outline : d.outline, width: typeof o.width === 'number' ? o.width : d.width };
    }
  } catch {
    /* defaults */
  }
  return d;
}
function saveTextStyle(t: TextStyle): void {
  try {
    localStorage.setItem('pocket-cut-nla:text-style', JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

/** keeps text and color changes in order, since rendering takes a moment */
let chain: Promise<void> = Promise.resolve();

async function textMedia(text: string, st: TextStyle): Promise<MediaInfo> {
  const r = await renderText(text, st.color, st.font, st.outline, st.width);
  const id = newId();
  registerMedia(id, r.blob, null, { name: text.slice(0, 24), bitmap: r.bitmap });
  const name = text.split('\n')[0]!.slice(0, 24) || 'Text';
  void saveMedia(id, { blob: r.blob, name, thumb: null });
  return { id, name, duration: IMAGE_MAX_SECONDS, width: r.width, height: r.height, hasAudio: false, kind: 'image', text, textColor: st.color, textFont: st.font, textOutline: st.outline, textWidth: st.width, textScale: r.scale, textBox: r.box };
}

/** A new text ("Text", in the last used style) at the position marker, on the first free lane from 0 up. */
export async function addTextClip(): Promise<void> {
  const st = loadTextStyle();
  const info = await textMedia('Text', st);
  const dur = state.prefs.imageSeconds;
  const at = state.playhead;
  const track = freeTrack(state.project.clips, at, dur, 0);
  const clip: Clip = { id: newId(), mediaId: info.id, start: 0, end: dur, speed: 1, view: { ...IDENTITY_VIEW, zoom: 0.8 }, volume: 1, keepPitch: true, at, track };
  const index = state.project.clips.length;
  edit((p) => ({ ...p, media: { ...p.media, [info.id]: info }, clips: [...p.clips, clip] }));
  selectClip(index);
  set({ drawer: 'text', tool: 'text' });
}

/** Changes the text, color, font or outline of a text clip. The picture is drawn again; its size on the canvas stays. */
export function editText(index: number, patch: Partial<TextStyle> & { text?: string }): Promise<void> {
  chain = chain.then(async () => {
    const c = state.project.clips[index];
    const m = c && state.project.media[c.mediaId];
    if (!c || !m || m.text === undefined) return;
    const st: TextStyle = { color: m.textColor ?? '#ffffff', font: m.textFont ?? 'sans', outline: m.textOutline ?? autoOutline(m.textColor ?? '#ffffff'), width: m.textWidth ?? 14, ...patch };
    // a new text color on a text that still had the automatic outline keeps it automatic
    if (patch.color && patch.outline === undefined && (m.textOutline ?? autoOutline(m.textColor ?? '#ffffff')) === autoOutline(m.textColor ?? '#ffffff')) st.outline = autoOutline(patch.color);
    const info = await textMedia(patch.text ?? m.text, st);
    const now = state.project.clips.findIndex((x) => x.id === c.id);
    const cur = state.project.clips[now];
    if (!cur) return;
    const out = outputSize(state.project);
    const keep = (baseScale(m.width, m.height, out.w, out.h) * (m.textScale ?? 1)) / (baseScale(info.width, info.height, out.w, out.h) * (info.textScale ?? 1));
    saveTextStyle(st);
    edit((p) => ({ ...p, media: { ...p.media, [info.id]: info }, clips: p.clips.map((x, i) => (i === now ? { ...x, mediaId: info.id, crop: undefined, view: { ...x.view, zoom: x.view.zoom * keep } } : x)) }), { key: `text:${c.id}` });
  });
  return chain;
}

/** A flat color picture ("color"), the length of a picture, at the position marker. */
export async function addSolid(color: string): Promise<void> {
  // a new color clip has the shape of the canvas
  const o = outputSize(state.project);
  const r = await renderSolid(color, 64, Math.max(8, Math.round((64 * o.h) / o.w)));
  const id = newId();
  registerMedia(id, r.blob, null, { name: 'Color', bitmap: r.bitmap });
  void saveMedia(id, { blob: r.blob, name: 'Color', thumb: null });
  const info: MediaInfo = { id, name: 'Color', duration: IMAGE_MAX_SECONDS, width: r.width, height: r.height, hasAudio: false, kind: 'image', solid: color };
  const dur = state.prefs.imageSeconds;
  const at = state.playhead;
  const track = freeTrack(state.project.clips, at, dur, 0);
  const out = outputSize(state.project);
  const clip: Clip = { id: newId(), mediaId: id, start: 0, end: dur, speed: 1, view: { ...IDENTITY_VIEW, zoom: fillZoom(r.width, r.height, 0, out.w, out.h) }, volume: 1, keepPitch: true, at, track };
  const index = state.project.clips.length;
  edit((p) => ({ ...p, media: { ...p.media, [id]: info }, clips: [...p.clips, clip] }));
  selectClip(index);
  set({ drawer: 'color', tool: 'color' });
}

export function setSolidColor(index: number, color: string): Promise<void> {
  chain = chain.then(async () => {
    const c = state.project.clips[index];
    const m = c && state.project.media[c.mediaId];
    if (!c || !m || m.solid === undefined) return;
    const r = await renderSolid(color, m.width, m.height);
    const id = newId();
    registerMedia(id, r.blob, null, { name: 'Color', bitmap: r.bitmap });
    void saveMedia(id, { blob: r.blob, name: 'Color', thumb: null });
    const info: MediaInfo = { ...m, id, solid: color };
    const now = state.project.clips.findIndex((x) => x.id === c.id);
    if (now < 0) return;
    edit((p) => ({ ...p, media: { ...p.media, [id]: info }, clips: p.clips.map((x, i) => (i === now ? { ...x, mediaId: id } : x)) }), { key: `solid:${c.id}` });
  });
  return chain;
}

/** Cuts the selected clip in two at the position marker. */
export function splitAtPlayhead(): boolean {
  const { project, playhead } = state;
  let selected = state.selected;
  if (!project.clips[selected]) {
    // nothing selected: cut the top-most clip under the yellow line
    const under = activeAt(project.clips, playhead).filter((i) => project.media[project.clips[i]!.mediaId]);
    selected = under[under.length - 1] ?? -1;
  }
  const c = project.clips[selected];
  if (!c) return false;
  const local = playhead - c.at;
  if (local <= 0 || local >= clipDuration(c)) return false;
  const cut = c.start + local * c.speed;
  if (cut - c.start < MIN_CLIP || c.end - cut < MIN_CLIP) return false;
  edit((p) => ({
    ...p,
    clips: [...p.clips.slice(0, selected), { ...c, end: cut }, { ...c, id: newId(), start: cut, at: playhead }, ...p.clips.slice(selected + 1)],
  }));
  set({ selected: selected + 1 });
  return true;
}

export function setSettings(patch: Partial<ExportSettings>): void {
  edit((p) => ({ ...p, settings: { ...p.settings, ...patch } }), { history: false });
  savePrefs(state.project.settings);
}

export function setName(name: string): void {
  edit((p) => ({ ...p, name }), { history: false });
}

// ---------- import ----------

export async function importFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const added: Clip[] = [];
  const media: Project['media'] = {};
  let failed = 0;
  let lastError = '';
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const image = isImageFile(file);
    const audio = !image && isAudioFile(file);
    set({ busy: files.length > 1 ? `Reading ${i + 1} of ${files.length}…` : image ? 'Reading picture…' : audio ? 'Reading sound…' : 'Reading video…' });
    const id = newId();
    try {
      let info: MediaInfo;
      let thumb: Blob | null;
      if (image) {
        const r = await probeImage(file, id);
        info = r.info;
        thumb = r.thumb;
        registerMedia(id, file, thumb, { name: file.name, bitmap: r.bitmap });
      } else if (audio) {
        const r = await probeAudio(file, id);
        info = r.info;
        thumb = r.thumb;
        registerMedia(id, file, thumb, { name: file.name });
      } else {
        const r = await probeVideo(file, id);
        info = r.info;
        thumb = r.thumb;
        registerMedia(id, file, thumb, { name: file.name });
      }
      media[id] = info;
      const track = audio ? -1 : 0;
      // new clips go to the end of their lane, one after another
      const at = endOfTrack([...state.project.clips, ...added], track);
      added.push({ id: newId(), mediaId: id, start: 0, end: image ? Math.min(info.duration, state.prefs.imageSeconds) : info.duration, speed: 1, view: { ...IDENTITY_VIEW }, volume: 1, keepPitch: true, at, track });
      void saveMedia(id, { blob: file, name: file.name, thumb });
      queueProxy(id, info, state.prefs.previewLong);
    } catch (e) {
      failed++;
      lastError = e instanceof UnsupportedMediaError ? e.message : `Could not open "${file.name}".`;
    }
  }
  set({ busy: null });
  if (failed) toast(failed > 1 ? `${failed} files could not be opened. ${lastError}` : lastError);
  if (added.length === 0) return;
  const firstNew = state.project.clips.length;
  const first = state.project.clips.length === 0 ? (added.map((c) => media[c.mediaId]!).find((m) => m.kind !== 'audio') ?? null) : null;
  edit((p) => ({
    ...p,
    clips: [...p.clips, ...added],
    media: { ...p.media, ...media },
    name: first ? first.name : p.name || media[added[0]!.mediaId]!.name,
    // a new project starts with the canvas shape that suits its first picture
    settings: first ? { ...p.settings, aspect: nearestAspect(first.width, first.height) } : p.settings,
  }));
  selectClip(firstNew);
  added.forEach((c) => ensureWave(c.mediaId));
  void requestPersistence();
}

// ---------- saved project ----------

/** Brings a clip saved by an older version up to the current shape. */
function normalizeClip(raw: Clip): Clip {
  const o = raw as unknown as { view?: Clip['view']; rotation?: number; muted?: boolean; volume?: number; keepPitch?: boolean };
  return {
    ...raw,
    view: o.view ?? { ...IDENTITY_VIEW, rot: o.rotation === 90 ? 90 : o.rotation === 180 ? 180 : o.rotation === 270 ? -90 : 0 },
    volume: typeof o.volume === 'number' ? o.volume : o.muted ? 0 : 1,
    keepPitch: o.keepPitch ?? true,
  };
}

/** Re-reads the files from storage (a phone can drop its handle on a file while the app sleeps). */
export async function reloadMedia(): Promise<void> {
  const saved = await Promise.race([loadSaved(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
  if (!saved) return;
  for (const [id, m] of saved.media) {
    const info = state.project.media[id];
    if (!info || info.kind === 'image') continue;
    registerMedia(id, m.blob, m.thumb, { name: m.name, proxy: m.proxy ?? null });
  }
  set({ project: { ...state.project } });
}

export async function restore(): Promise<void> {
  // IndexedDB can hang forever in some Safari modes (for example private browsing). Don't wait for it.
  const saved = await Promise.race([loadSaved(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]);
  if (saved && saved.project.clips.length > 0) {
    const usable = new Set<string>();
    for (const [id, m] of saved.media) {
      const info = saved.project.media[id];
      try {
        const bitmap = info?.kind === 'image' ? await decodeImage(m.blob) : null;
        registerMedia(id, m.blob, m.thumb, { name: m.name, proxy: m.proxy ?? null, bitmap });
        usable.add(id);
        if (info && !m.proxy) queueProxy(id, info, state.prefs.previewLong);
      } catch {
        /* a picture that no longer decodes is dropped below */
      }
    }
    // older saves had 90-degree turns, a crop and a mute switch: carry over what still exists
    let run = 0;
    const clips = saved.project.clips
      .filter((c) => usable.has(c.mediaId))
      .map(normalizeClip)
      .map((c) => {
        // a project saved as a plain sequence: lay the clips end to end on the first lane
        const old = typeof (c as Partial<Clip>).at !== 'number';
        const placed = old ? { ...c, at: run, track: 0 } : c;
        run = Math.max(run, clipEnd(placed));
        return placed;
      });
    const settings = loadPrefs();
    if (!(saved.project.settings?.aspect in ASPECT_VALUE)) {
      const m = clips[0] && saved.project.media[clips[0].mediaId];
      settings.aspect = m ? nearestAspect(m.width, m.height) : '9:16';
    } else settings.aspect = saved.project.settings.aspect;
    clearHistory();
    set({ project: { ...saved.project, clips, settings }, selected: -1, ready: true });
    for (const id of Object.keys(saved.project.media)) ensureWave(id);
  } else {
    set({ ready: true });
  }
}

export async function discardProject(): Promise<void> {
  dropAllMedia();
  await clearSaved();
  clearHistory();
  set({ project: freshProject(), selected: -1, playhead: 0, playing: false, sheet: 'none', tool: 'speed' });
}

let saveTimer = 0;
let lastSaved: Project | null = null;
subs.add(() => {
  if (!state.ready || state.project === lastSaved) return;
  const p = state.project;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    lastSaved = p;
    if (p.clips.length === 0) void clearSaved();
    else void saveProject(p, mediaInHistory());
  }, 600);
});

export const blobFor = mediaBlob;

setAwakeMode(state.prefs.awake);
onProxyWork((working) => set({ preparing: working }));
onProxyProgress((id, p) => {
  const next = { ...state.proxyProgress };
  if (p === null) delete next[id];
  else next[id] = p;
  set({ proxyProgress: next });
});
setProxyOrder(() => {
  const ids = state.project.clips.map((c) => c.mediaId);
  const sel = ids[state.selected];
  return sel ? [sel, ...ids.filter((i) => i !== sel)] : ids;
});

// ---------- gaps ----------

/** Closes the picked gap: later clips move earlier, and the ones that would collide hop to the next free lane. */
export function removeGap(): void {
  const g = state.gap;
  if (!g) return;
  const sel = state.project.clips[state.selected]?.id;
  edit((p) => ({ ...p, clips: removeGapFrom(p.clips, g) }));
  const i = state.project.clips.findIndex((c) => c.id === sel);
  set({ gap: null, selected: i });
}

// ---------- crop ----------

export function setCrop(index: number, crop: Clip['crop']): void {
  const empty = !crop || (crop.l === 0 && crop.t === 0 && crop.r === 0 && crop.b === 0);
  updateClip(index, { crop: empty ? undefined : crop });
}

/** Puts the picture back where it starts: centered, whole picture visible, no crop. */
export function resetTransform(index: number): void {
  const c = state.project.clips[index];
  const m = c && state.project.media[c.mediaId];
  if (!c || !m) return;
  const out = outputSize(state.project);
  const zoom = m.solid !== undefined ? fillZoom(m.width, m.height, 0, out.w, out.h) : m.text !== undefined ? 0.8 : 1;
  updateClip(index, { view: { ...IDENTITY_VIEW, zoom }, crop: undefined });
}

// ---------- waveforms ----------

const waving = new Set<string>();
/** Makes the loudness outline of a sound file in the background (once per file). */
export function ensureWave(id: string): void {
  const m = state.project.media[id];
  if (!m || m.kind !== 'audio' || state.waves[id] || waving.has(id)) return;
  const blob = mediaBlob(id);
  if (!blob) return;
  waving.add(id);
  void computePeaks(blob).then((p) => {
    waving.delete(id);
    if (p) set({ waves: { ...state.waves, [id]: p } });
  });
}
