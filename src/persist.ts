import type { Project } from './types.ts';

/**
 * Autosave of the last project (JSON + the original video files) in IndexedDB.
 * It stays until the user deletes it. Everything is best-effort: if storage is blocked or full the
 * editor keeps working, it just won't remember anything.
 */
const DB = 'pwa-video-editor';

export interface SavedMedia {
  blob: Blob;
  name: string;
  thumb: Blob | null;
  /** small preview copy of a video, if it was made */
  proxy?: Blob | null;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

export async function saveMedia(id: string, m: SavedMedia): Promise<boolean> {
  try {
    const db = await open();
    const tx = db.transaction('media', 'readwrite');
    tx.objectStore('media').put(m, id);
    await done(tx);
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Saves the project JSON and drops stored media the project no longer uses. */
export async function saveProject(p: Project, keep: Set<string> = new Set()): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(['kv', 'media'], 'readwrite');
    tx.objectStore('kv').put(p, 'project');
    const used = new Set([...p.clips.map((c) => c.mediaId), ...keep]);
    const media = tx.objectStore('media');
    const keys = await wrap(media.getAllKeys());
    for (const k of keys) if (!used.has(String(k))) media.delete(k);
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

export async function loadSaved(): Promise<{ project: Project; media: Map<string, SavedMedia> } | null> {
  try {
    const db = await open();
    const project = (await wrap(db.transaction('kv').objectStore('kv').get('project'))) as Project | undefined;
    if (!project || project.version !== 1 || !Array.isArray(project.clips)) {
      db.close();
      return null;
    }
    const store = db.transaction('media').objectStore('media');
    const media = new Map<string, SavedMedia>();
    for (const key of await wrap(store.getAllKeys())) media.set(String(key), (await wrap(store.get(key))) as SavedMedia);
    db.close();
    return { project, media };
  } catch {
    return null;
  }
}

export async function clearSaved(): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(['kv', 'media'], 'readwrite');
    tx.objectStore('kv').clear();
    tx.objectStore('media').clear();
    await done(tx);
    db.close();
  } catch {
    /* ignore */
  }
}

/** Asks the browser not to evict our data under storage pressure. Safe to call repeatedly. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
