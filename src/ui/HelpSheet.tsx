import { useStore } from '../store.ts';
import { Sheet } from './Sheet.tsx';

const CURRENT: Record<string, { title: string; text: string }> = {
  trim: {
    title: 'Trim',
    text: 'Drag the yellow ends to keep only the part you want. Drag anywhere else on the bar to look around the clip. Hold your finger still for a moment while dragging, then keep sliding: it moves ten times slower, for exact cuts.',
  },
  duration: {
    title: 'Duration',
    text: 'How long this picture stays on screen. The slider snaps to round numbers. Hold your finger still on the slider for a moment, then slide, to set an exact time.',
  },
  clip: {
    title: 'Clip',
    text: 'Split cuts the clip in two at the position marker. Duplicate copies it, Turn 90° rotates it, Reset position puts it back in the middle, and Delete removes it (Undo at the top brings it back).',
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
  const key = picture && tool !== 'clip' ? 'duration' : tool;
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
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, to quarter turns, and to "fits the whole frame" and "fills the frame". Double-tap the preview to snap to the closest tidy placement (a quarter turn, fitting or filling); double-tap again to switch between fit and fill. Shrink it for black bars, enlarge it to fill the frame. The shape of the canvas is set with the button at the top.</p>
      </section>
      <section>
        <h3>Clips</h3>
        <p>Tap a thumbnail to select it. To reorder, press and hold a thumbnail until it lifts, then drag it left or right (the strip scrolls when you reach the edge). The pie on a thumbnail means its smooth-preview copy is still being made.</p>
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
