import { setSettings, useStore } from '../store.ts';
import type { AspectChoice } from '../types.ts';
import { Sheet } from './Sheet.tsx';

export const ASPECT_LABEL: Record<AspectChoice, string> = { '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '5:4': '5:4', '16:9': '16:9' };
export const BACKGROUNDS = ['#000000', '#ffffff', '#1c2329', '#f0c64a', '#ff5d5d', '#6ee7a8', '#6db3ff', '#b58cff'] as const;
const ASPECTS: AspectChoice[] = ['9:16', '4:5', '1:1', '5:4', '16:9'];

/** The shape of the exported picture, and how the selected clip sits in it. */
export function CanvasSheet({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.project.settings.aspect);
  const bg = useStore((s) => s.project.settings.background);
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
        <p class="hint">The shape of the exported video. It starts with the shape that suits your first clip. Move, zoom and turn each clip right on the preview to place it.</p>
      </section>
      <section>
        <h3>Background color</h3>
        <div class="chips" role="group" aria-label="Background color">
          {BACKGROUNDS.map((c) => (
            <button key={c} class={`swatch ${c === bg ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={c === bg} onClick={() => setSettings({ background: c })} />
          ))}
          <label class={`swatch custom ${BACKGROUNDS.includes(bg as never) ? '' : 'on'}`} style={{ background: BACKGROUNDS.includes(bg as never) ? undefined : bg }} aria-label="Pick any color">
            <input type="color" value={bg} onInput={(e) => setSettings({ background: (e.currentTarget as HTMLInputElement).value })} />
          </label>
        </div>
        <p class="hint">Shows wherever no picture covers the canvas, in the preview and in the export.</p>
      </section>
      <button class="cta" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
