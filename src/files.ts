import { importFiles } from './store.ts';

/** Opens the system file / photo picker. Must be called from a tap. */
export function pickVideos(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*,.mp4,.mov,.m4v,.webm,.mkv,.3gp';
  input.multiple = true;
  input.onchange = () => void importFiles([...(input.files ?? [])]);
  input.click();
}

export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 60_000);
}

export type ShareResult = 'shared' | 'cancelled' | 'unsupported';

/** Opens the system share sheet with all files at once (on phones this offers "Save to Photos"). */
export async function shareFiles(files: { name: string; blob: Blob }[]): Promise<ShareResult> {
  const list = files.map((f) => new File([f.blob], f.name, { type: 'video/mp4' }));
  if (!navigator.canShare?.({ files: list })) return 'unsupported';
  try {
    await navigator.share({ files: list });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

export const fmtBytes = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
