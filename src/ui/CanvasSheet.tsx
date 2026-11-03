import { setSettings, useStore } from '../store.ts';
import type { AspectChoice } from '../types.ts';
import { Sheet } from './Sheet.tsx';

export const ASPECT_LABEL: Record<AspectChoice, string> = { auto: 'Auto', '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '16:9': '16:9' };
const ASPECTS: AspectChoice[] = ['auto', '9:16', '4:5', '1:1', '16:9'];

/** The shape of the exported picture, and how the selected clip sits in it. */
export function CanvasSheet({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.project.settings.aspect);
  return (
    <Sheet title="Canvas" onClose={onClose}>
      <section>
        <h3>Shape of the video</h3>
        <div class="chips" role="group" aria-label="Canvas shape">
          {ASPECTS.map((a) => (
            <button key={a} class={`chip num ${aspect === a ? 'on' : ''}`} aria-pressed={aspect === a} onClick={() => setSettings({ aspect: a })}>
              {ASPECT_LABEL[a]}
            </button>
          ))}
        </div>
        <p class="hint">The shape of the exported video. Move, zoom and turn each clip right on the preview to place it. Auto follows the first clip.</p>
      </section>
      <button class="cta" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
