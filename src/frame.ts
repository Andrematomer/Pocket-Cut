import { FriendlyError, exportFrame } from './exporter.ts';
import { saveBlob, shareFiles } from './files.ts';
import { say } from './hud.ts';
import { blobFor, getState } from './store.ts';
import { fmtTime } from './timeline.ts';

let busy = false;

/** Saves the picture on screen at the yellow line as a PNG (at most 1080p): the share sheet on phones, a download on computers. */
export async function saveFrame(): Promise<void> {
  if (busy) return;
  busy = true;
  say('Making the picture…', 8000);
  try {
    const st = getState();
    const blob = await exportFrame(st.project, (id) => blobFor(id), st.playhead);
    const base = (st.project.name || 'frame').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
    const name = `${base}_${fmtTime(st.playhead, 1).replace(/[^0-9]/g, '')}.png`;
    const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const r = phone ? await shareFiles([{ name, blob }], 'image/png') : 'unsupported';
    if (r === 'unsupported') saveBlob(name, blob);
    say(r === 'cancelled' ? 'Cancelled' : 'Picture saved');
  } catch (e) {
    say(e instanceof FriendlyError ? e.message : 'Could not make the picture', 2500);
  } finally {
    busy = false;
  }
}
