import { importFiles } from './store.ts';

export const ACCEPT = 'video/*,image/*,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,.mp4,.mov,.m4v,.webm,.mkv,.3gp,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.avif,.mp3,.m4a,.wav,.aac,.caf';
export const PICKER_ID = 'pc-file-input';

/**
 * Reads what the person chose. The files are copied to a plain array first and the input is emptied
 * afterwards, so picking the same file twice still works.
 */
export function onPicked(input: HTMLInputElement): void {
  const files = [...(input.files ?? [])];
  input.value = '';
  void importFiles(files);
}

/**
 * One file input lives in the page for good (see FilePicker). Buttons that add videos are <label>s for
 * it: a tap on a label opens the system picker directly, which iPhone home-screen apps accept, while an
 * input made on the fly in code and clicked from a script is not reliable there.
 */
export function pickVideos(): void {
  (document.getElementById(PICKER_ID) as HTMLInputElement | null)?.click();
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
