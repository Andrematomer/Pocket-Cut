import { mediaBitmap, mediaBlob, mediaUrl } from './media.ts';
import { PreviewEngine } from './preview.ts';
import { getState, set } from './store.ts';

/** The single preview player shared by the whole UI. */
export const engine = new PreviewEngine({
  getProject: () => getState().project,
  getUrl: mediaUrl,
  getImage: mediaBitmap,
  getBlob: mediaBlob,
  onTime: (t) => set({ playhead: t }),
  onPlaying: (playing) => set({ playing }),
});

