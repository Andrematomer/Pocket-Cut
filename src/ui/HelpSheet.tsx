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
        <h3>Strips and gaps</h3>
        <p>Tap a strip to select it. Drag the yellow handles on its ends to trim. Press and hold a strip until it lifts, then drag it in time or to another lane; it snaps to other clips and to the yellow line. Tap empty space between two strips to pick the gap (yellow box); tap it again for Remove gap, which pulls everything after it earlier. Anything that would then collide on another lane hops up to the next free lane.</p>
      </section>
      <section>
        <h3>Tabs</h3>
        <p>The tabs under the timeline (Speed, Sound, Look, Clip) raise a drawer over the lower part of the timeline. Tap the open tab again, or anywhere outside the drawer, to put it away. Look has opacity, brightness, contrast, color and warmth for pictures and video. Clip has split, edit text, crop, duplicate and delete. Deleting pulls everything after it forward.</p>
      </section>
      <section>
        <h3>Place the picture on the canvas</h3>
        <p>Touch the preview. One finger moves the clip. Two fingers pinch to zoom and twist to turn it. Hold still for a moment and it moves ten times slower, for exact placement. It snaps to the middle, the frame edges, quarter turns, and to "fits the whole frame" and "fills the frame". Double-tap the preview to snap to the closest tidy placement; double-tap again to switch between fit and fill. A picture can be dragged until only a tenth of it is left in the frame.</p>
        <p>Tap the picture once to show four crop handles on its sides; drag one to cut that side off. The canvas button at the top sets the video shape and the background color.</p>
      </section>
      <section>
        <h3>Fine control</h3>
        <p>Everything you drag has a precision mode, like the iPhone Photos app: hold your finger still anywhere along the drag for a moment and it switches to slow motion from that point. It glows while it is on.</p>
      </section>
      <section>
        <h3>Text and sound</h3>
        <p>The Aa button adds text in a font and color of your choice (the next text starts from the last one you used), which then behaves like a picture. Sound files (mp3, m4a, wav) go on the A lanes. The handle under the preview can be dragged to give the preview or the timeline more room.</p>
      </section>
      <section>
        <h3>Export</h3>
        <p>Pick quality and, if you want, split the video into parts of a fixed length. After exporting, use Share to send the files or save them to your gallery.</p>
      </section>
    </Sheet>
  );
}
