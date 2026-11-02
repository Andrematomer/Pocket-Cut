import { useEffect, useRef, useState } from 'preact/hooks';
import { cropForAspect, rotateCrop, rotatedSize } from './geometry.ts';
import { IMAGE_DEFAULT_SECONDS, decodeImage, dropAllMedia, dropMedia, isImageFile, mediaBlob, newId, probeImage, probeVideo, registerMedia, UnsupportedMediaError } from './media.ts';
import { onProxyWork, queueProxy } from './proxy.ts';
import { clearSaved, loadSaved, requestPersistence, saveMedia, saveProject } from './persist.ts';
import { layout, MAX_SPEED, MIN_CLIP, MIN_SPEED, locate } from './timeline.ts';
import { DEFAULT_SETTINGS, emptyProject, type Clip, type ExportSettings, type MediaInfo, type Project } from './types.ts';

export type Tool = 'trim' | 'speed' | 'rotate' | 'crop' | 'sound' | 'clip';
export type Sheet = 'none' | 'export' | 'settings' | 'canvas';

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
}

let state: State = {
  project: freshProject(),
  selected: 0,
  tool: 'trim',
  playhead: 0,
  playing: false,
  busy: null,
  toast: null,
  sheet: 'none',
  ready: false,
  preparing: false,
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
    const raw = localStorage.getItem('pocket-cut:export-settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ExportSettings>) };
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function savePrefs(s: ExportSettings): void {
  try {
    localStorage.setItem('pocket-cut:export-settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function freshProject(): Project {
  return { ...emptyProject(), settings: loadPrefs() };
}

// ---------- project edits ----------

function edit(fn: (p: Project) => Project): void {
  const project = { ...fn(state.project), updated: Date.now() };
  const selected = Math.max(0, Math.min(state.selected, project.clips.length - 1));
  set({ project, selected, playhead: Math.min(state.playhead, layout(project.clips).total) });
}

export function updateClip(index: number, patch: Partial<Clip>): void {
  edit((p) => ({ ...p, clips: p.clips.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
}

export function setSpeed(index: number, speed: number): void {
  updateClip(index, { speed: Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100)) });
}

export function rotateClip(index: number, dir: 'cw' | 'ccw'): void {
  const c = state.project.clips[index];
  if (!c) return;
  const rotation = ((c.rotation + (dir === 'cw' ? 90 : 270)) % 360) as Clip['rotation'];
  const crop = rotateCrop(c.crop, dir);
  updateClip(index, { rotation, crop, cropAspect: c.cropAspect ? 1 / c.cropAspect : null });
}

/** Locks the crop to an aspect (w/h) and fits the biggest centered crop of that shape. */
export function setCropAspect(index: number, aspect: number | null): void {
  const c = state.project.clips[index];
  const m = c && state.project.media[c.mediaId];
  if (!c || !m) return;
  if (aspect === null) return updateClip(index, { cropAspect: null });
  const r = rotatedSize(m.width, m.height, c.rotation);
  updateClip(index, { cropAspect: aspect, crop: cropForAspect(r.w, r.h, aspect) });
}

export function setTrim(index: number, start: number, end: number): void {
  const c = state.project.clips[index];
  const m = c && state.project.media[c.mediaId];
  if (!c || !m) return;
  const s = Math.max(0, Math.min(start, m.duration - MIN_CLIP));
  const e = Math.min(m.duration, Math.max(end, s + MIN_CLIP));
  updateClip(index, { start: s, end: e });
}

export function moveClip(index: number, dir: -1 | 1): void {
  const j = index + dir;
  const clips = state.project.clips;
  if (j < 0 || j >= clips.length) return;
  edit((p) => {
    const next = [...p.clips];
    [next[index], next[j]] = [next[j]!, next[index]!];
    return { ...p, clips: next };
  });
  set({ selected: j });
}

export function duplicateClip(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  edit((p) => ({ ...p, clips: [...p.clips.slice(0, index + 1), { ...c, id: newId() }, ...p.clips.slice(index + 1)] }));
  set({ selected: index + 1 });
}

export function deleteClip(index: number): void {
  const c = state.project.clips[index];
  if (!c) return;
  const stillUsed = state.project.clips.some((x, i) => i !== index && x.mediaId === c.mediaId);
  edit((p) => {
    const clips = p.clips.filter((_, i) => i !== index);
    const media = { ...p.media };
    if (!stillUsed) delete media[c.mediaId];
    return { ...p, clips, media };
  });
  if (!stillUsed) dropMedia(c.mediaId);
}

/** Cuts the selected clip in two at the playhead. */
export function splitAtPlayhead(): boolean {
  const { project, playhead } = state;
  const L = layout(project.clips);
  const at = locate(L, playhead);
  if (!at) return false;
  const c = project.clips[at.index]!;
  const cut = c.start + at.local * c.speed;
  if (cut - c.start < MIN_CLIP || c.end - cut < MIN_CLIP) return false;
  edit((p) => ({
    ...p,
    clips: [...p.clips.slice(0, at.index), { ...c, end: cut }, { ...c, id: newId(), start: cut }, ...p.clips.slice(at.index + 1)],
  }));
  set({ selected: at.index + 1 });
  return true;
}

export function setSettings(patch: Partial<ExportSettings>): void {
  edit((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  savePrefs(state.project.settings);
}

export function setName(name: string): void {
  edit((p) => ({ ...p, name }));
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
    set({ busy: files.length > 1 ? `Reading ${i + 1} of ${files.length}…` : image ? 'Reading picture…' : 'Reading video…' });
    const id = newId();
    try {
      let info: MediaInfo;
      let thumb: Blob | null;
      if (image) {
        const r = await probeImage(file, id);
        info = r.info;
        thumb = r.thumb;
        registerMedia(id, file, thumb, { name: file.name, bitmap: r.bitmap });
      } else {
        const r = await probeVideo(file, id);
        info = r.info;
        thumb = r.thumb;
        registerMedia(id, file, thumb, { name: file.name });
      }
      media[id] = info;
      added.push({ id: newId(), mediaId: id, start: 0, end: image ? IMAGE_DEFAULT_SECONDS : info.duration, speed: 1, rotation: 0, crop: null, cropAspect: null, muted: false, fit: 'contain', keepPitch: true });
      void saveMedia(id, { blob: file, name: file.name, thumb });
      queueProxy(id, info);
    } catch (e) {
      failed++;
      lastError = e instanceof UnsupportedMediaError ? e.message : `Could not open "${file.name}".`;
    }
  }
  set({ busy: null });
  if (failed) toast(failed > 1 ? `${failed} files could not be opened. ${lastError}` : lastError);
  if (added.length === 0) return;
  const firstNew = state.project.clips.length;
  edit((p) => ({ ...p, clips: [...p.clips, ...added], media: { ...p.media, ...media }, name: p.clips.length === 0 ? media[added[0]!.mediaId]!.name : p.name }));
  set({ selected: firstNew, tool: 'trim' });
  void requestPersistence();
}

// ---------- saved project ----------

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
        if (info && !m.proxy) queueProxy(id, info);
      } catch {
        /* a picture that no longer decodes is dropped below */
      }
    }
    // older saves kept "fit" in the export settings and had no pitch option: carry it over per clip
    const oldFit = (saved.project.settings as { fit?: Clip['fit'] } | undefined)?.fit === 'cover' ? 'cover' : 'contain';
    const clips = saved.project.clips
      .filter((c) => usable.has(c.mediaId))
      .map((c) => ({ ...c, fit: c.fit ?? oldFit, keepPitch: c.keepPitch ?? true }));
    set({ project: { ...saved.project, clips, settings: loadPrefs() }, selected: 0, ready: true });
  } else {
    set({ ready: true });
  }
}

export async function discardProject(): Promise<void> {
  dropAllMedia();
  await clearSaved();
  set({ project: freshProject(), selected: 0, playhead: 0, playing: false, sheet: 'none', tool: 'trim' });
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
    else void saveProject(p);
  }, 600);
});

export const blobFor = mediaBlob;

onProxyWork((working) => set({ preparing: working }));
