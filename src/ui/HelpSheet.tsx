import { Sheet } from './Sheet.tsx';

/** The manual. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="How it works" onClose={onClose}>
      <section>
        <h3>Timeline</h3>
        <p>Every clip is a strip on a lane. The yellow line is fixed: scroll the timeline under it to move through the video, and pinch to zoom. Lanes higher up are drawn on top of the lanes below, so you can layer a small video over a big one. Sound sits on the A lanes. Two empty lanes are always open beyond the last one in use.</p>
      </section>
      <section>
        <h3>Strips</h3>
        <p>Tap a strip to select it. Drag the yellow handles on its ends to trim. Press and hold a strip until it lifts, then drag it in time or to another lane; it snaps to other clips and to the yellow line. Tap the selected strip again (or hold it and let go in place) for its options: speed, volume, split, duplicate, delete. Deleting pulls everything after it forward.</p>
      </section>
      <section>
        <h3>Place the picture on the canvas</h3>
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, the frame edges, quarter turns, and to "fits the whole frame" and "fills the frame". Double-tap the preview to snap to the closest tidy placement; double-tap again to switch between fit and fill.</p>
      </section>
      <section>
        <h3>Fine control</h3>
        <p>Everything you drag has a precision mode, like the iPhone Photos app: hold your finger still anywhere along the drag for a moment and it switches to slow motion from that point. It glows while it is on.</p>
      </section>
      <section>
        <h3>Text and sound</h3>
        <p>The Aa button adds text, which then behaves like a picture. Sound files (mp3, m4a, wav) go on the A lanes. The handle under the preview can be dragged to give the preview or the timeline more room.</p>
      </section>
      <section>
        <h3>Export</h3>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </section>
    </Sheet>
  );
}
