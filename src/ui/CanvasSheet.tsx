import { setSettings, useStore } from '../store.ts';
import type { AspectChoice } from '../types.ts';
import { ColorRow } from './Drawer.tsx';
import { Fold } from './Fold.tsx';
import { Sheet } from './Sheet.tsx';

export const ASPECT_LABEL: Record<AspectChoice, string> = { '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '5:4': '5:4', '16:9': '16:9' };
const ASPECTS: AspectChoice[] = ['9:16', '4:5', '1:1', '5:4', '16:9'];

/** The shape of the exported picture, and how the selected clip sits in it. */
export function CanvasSheet({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.project.settings.aspect);
  const bg = useStore((s) => s.project.settings.background);
  return (
    <Sheet title="Ratio" onClose={onClose}>
      <Fold title="Ratio" hint={<>The shape of the exported video. It starts with the shape that suits your first clip. Move, zoom and turn each clip right on the preview to place it.</>}>
        <div class="chips" role="group" aria-label="Canvas shape">
          {ASPECTS.map((a) => (
            <button key={a} class={`chip num ${aspect === a ? 'on' : ''}`} aria-pressed={aspect === a} onClick={() => setSettings({ aspect: a })}>
              {ASPECT_LABEL[a]}
            </button>
          ))}
        </div>
        
      </Fold>
      <Fold title="Background color" hint={<>Tap the color to open your system's color picker. The color shows wherever no picture covers the canvas, in the preview and in the export.</>}>
        <ColorRow label="Background color" value={bg} onPick={(c) => setSettings({ background: c })} />
      </Fold>
      <button class="cta" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
