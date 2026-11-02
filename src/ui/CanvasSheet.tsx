import { setSettings, updateClip, useStore } from '../store.ts';
import type { AspectChoice } from '../types.ts';
import { Sheet } from './Sheet.tsx';

export const ASPECT_LABEL: Record<AspectChoice, string> = { auto: 'Auto', '9:16': '9:16', '4:5': '4:5', '1:1': '1:1', '16:9': '16:9' };
const ASPECTS: AspectChoice[] = ['auto', '9:16', '4:5', '1:1', '16:9'];

/** The shape of the exported picture, and how the selected clip sits in it. */
export function CanvasSheet({ onClose }: { onClose: () => void }) {
  const aspect = useStore((s) => s.project.settings.aspect);
  const clip = useStore((s) => s.project.clips[s.selected]);
  const index = useStore((s) => s.selected);
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
        <p class="hint">Auto follows the first clip. 9:16 is for Stories and Reels.</p>
      </section>
      {clip && (
        <section>
          <h3>Selected clip in this canvas</h3>
          <div class="chips" role="group" aria-label="Picture fit">
            <button class={`chip ${clip.fit === 'contain' ? 'on' : ''}`} aria-pressed={clip.fit === 'contain'} onClick={() => updateClip(index, { fit: 'contain' })}>
              Fit (bars)
            </button>
            <button class={`chip ${clip.fit === 'cover' ? 'on' : ''}`} aria-pressed={clip.fit === 'cover'} onClick={() => updateClip(index, { fit: 'cover' })}>
              Fill (trim edges)
            </button>
          </div>
          <p class="hint">Only visible when the clip's shape differs from the canvas. Each clip has its own setting.</p>
        </section>
      )}
      <button class="cta" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
