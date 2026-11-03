import { useStore } from '../store.ts';
import { Sheet } from './Sheet.tsx';

const CURRENT: Record<string, { title: string; text: string }> = {
  trim: {
    title: 'Trim',
    text: 'Drag the yellow ends to keep only the part you want. Drag anywhere else on the bar to look around the clip. Press and hold a yellow end for a moment, then slide: it moves ten times slower, for exact cuts. The scissors button next to play cuts the clip in two at the position marker.',
  },
  duration: {
    title: 'Duration',
    text: 'How long this picture stays on screen. The slider snaps to round numbers. Press and hold the round handle for a moment, then slide, to set an exact time.',
  },
  speed: {
    title: 'Speed',
    text: 'Slide to play this clip faster or slower. It snaps to the usual speeds, with 1× in the middle. Press and hold the round handle, then slide, to pick any speed in between. "Pitch kept" keeps voices natural; switch it to make voices rise and fall with the speed.',
  },
  sound: {
    title: 'Sound',
    text: 'Set how loud this clip is. Tap the speaker to mute, and tap again to bring the volume back. All the way left means fully muted. Press and hold the handle, then slide, for small steps.',
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
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. It snaps to the middle, to quarter turns, and to "fits the whole frame" and "fills the frame". Shrink it for black bars, enlarge it to fill the frame. The shape of the canvas is set with the button at the top.</p>
      </section>
      <section>
        <h3>Clips</h3>
        <p>Tap a thumbnail to select it. Press and hold a thumbnail to turn, reset, move, copy or remove the clip.</p>
      </section>
      <section>
        <h3>Fine control</h3>
        <p>Every slider and trim handle has a precision mode: press and hold the handle without moving, then slide. The handle glows while it is on.</p>
      </section>
      <section>
        <h3>Export</h3>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </section>
    </Sheet>
  );
}
