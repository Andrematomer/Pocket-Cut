import { useStore } from '../store.ts';
import { Sheet } from './Sheet.tsx';

const CURRENT: Record<string, { title: string; text: string }> = {
  trim: {
    title: 'Trim',
    text: 'Drag the yellow ends to keep only the part you want. Drag anywhere else on the bar to look around the clip. Hold your finger still for a moment while dragging, then keep sliding: it moves ten times slower, for exact cuts. The scissors button next to play cuts the clip in two at the position marker.',
  },
  duration: {
    title: 'Duration',
    text: 'How long this picture stays on screen. The slider snaps to round numbers. Hold your finger still on the slider for a moment, then slide, to set an exact time.',
  },
  order: {
    title: 'Order',
    text: 'Move the selected clip earlier or later in the video.',
  },
  speed: {
    title: 'Speed',
    text: 'Slide to play this clip faster or slower. It snaps to the usual speeds, with 1× in the middle. Hold your finger still for a moment, then slide, to pick any speed in between. "Pitch kept" keeps voices natural; switch it to make voices rise and fall with the speed.',
  },
  sound: {
    title: 'Sound',
    text: 'Set how loud this clip is. Tap the speaker to mute, and tap again to bring the volume back. All the way left means fully muted. Hold still for a moment, then slide, for small steps.',
  },
};

/** The manual. The first section always matches what is selected right now. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  const tool = useStore((s) => s.tool);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const picture = useStore((s) => {
    const c = s.project.clips[s.selected];
    return !!c && s.project.media[c.mediaId]?.kind === 'image';
  });
  const key = picture ? 'duration' : tool;
  const cur = CURRENT[key]!;
  return (
    <Sheet title="How it works" onClose={onClose}>
      {hasClips && (
        <section class="help-now">
          <h3>Selected now: {cur.title}</h3>
          <p>{cur.text}</p>
        </section>
      )}
      <section>
        <h3>Place the picture on the canvas</h3>
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, to quarter turns, and to "fits the whole frame" and "fills the frame". Shrink it for black bars, enlarge it to fill the frame. The shape of the canvas is set with the button at the top.</p>
      </section>
      <section>
        <h3>Clips</h3>
        <p>Tap a thumbnail to select it. Press and hold a thumbnail to turn, reset, copy or delete the clip. Use the Order tab to move it.</p>
      </section>
      <section>
        <h3>Fine control</h3>
        <p>Everything you drag has a precision mode, like the iPhone Photos app: hold your finger still anywhere along the drag for a moment and it switches to slow motion from that point. It glows while it is on.</p>
      </section>
      <section>
        <h3>Export</h3>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </section>
    </Sheet>
  );
}
