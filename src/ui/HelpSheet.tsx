import { Sheet } from './Sheet.tsx';

/** The manual. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How it works" onClose={onClose}>
      <section>
        <h3>Timeline</h3>
        <p>Every clip is a strip on a lane, and every lane takes any kind of clip. Lane 0 is where things start; higher lanes draw on top, lower lanes underneath, and two empty lanes are always open beyond the last one in use. The yellow line is fixed: scroll the timeline under it to move through the video, and pinch to zoom. The darker areas before 0 and after the last clip are outside the video.</p>
      </section>
      <section>
        <h3>Strips and gaps</h3>
        <p>Tap a strip to select it. Tap it again to show its trim handles (drag them to trim), and once more to hide them, which makes short strips easy to move. Press and hold a strip until it lifts, then drag it in time or to another lane; it snaps to its neighbors, and if you drop it on top of another strip it moves to the next free lane. Tap empty space between two strips to pick the gap (dark red); tap its trash can to close it. Everything after it moves earlier, and anything that would then collide hops to the next free lane.</p>
      </section>
      <section>
        <h3>Tabs</h3>
        <p>The tabs under the timeline raise a drawer over the lower part of the timeline. Tap the open tab again, or anywhere outside the drawer, to put it away. Video: Speed, Sound, Look, Clip. Text: Text, Color, Font, Outline, Look, Clip. Look has opacity, brightness, contrast, color and warmth. Tap a slider's name twice to reset it. Clip has split, crop, duplicate and delete.</p>
      </section>
      <section>
        <h3>Place the picture on the canvas</h3>
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, the frame edges, quarter turns, and to "fits the whole frame" and "fills the frame". Double-tap the preview to snap to the closest tidy placement; double-tap again to switch between fit and fill. A picture can be dragged until only a tenth of it is left in the frame.</p>
        <p>Tap the picture once to show four crop handles on its sides; drag one to cut that side off. Fit and Fill (double-tap) work on what is left after the crop. The canvas button at the top sets the video shape and the background color.</p>
      </section>
      <section>
        <h3>Fine control</h3>
        <p>Everything you drag has a precision mode, like the iPhone Photos app: hold your finger still anywhere along the drag for a moment and it switches to slow motion from that point. It glows while it is on.</p>
      </section>
      <section>
        <h3>Add</h3>
        <p>Add offers Media (videos, pictures, sound), Text and Empty. Text appears at the yellow line for the default picture time, on the first free lane, and is edited in its tabs. Empty is a flat color you pick in its Color tab, like a solid in After Effects. The handle under the preview can be dragged to give the preview or the timeline more room.</p>
      </section>
      <section>
        <h3>Export</h3>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </section>
    </Sheet>
  );
}
