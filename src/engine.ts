import { mediaBlob, mediaPreviewBitmap, mediaUrl } from './media.ts';
import { PreviewEngine } from './preview.ts';
import { onBakeChange, progress } from './bake.ts';
import { getState, set } from './store.ts';

/** The single preview player shared by the whole UI. */
export const engine = new PreviewEngine({
  getProject: () => getState().project,
  getUrl: mediaUrl,
  getImage: mediaPreviewBitmap,
  getBlob: mediaBlob,
  onTime: (t) => set({ playhead: t }),
  onPlaying: (playing) => set({ playing }),
  getEnd: () => getState().prefs.onEnd,
});


onBakeChange(() => set({ bakeProgress: Object.fromEntries(progress) }));
