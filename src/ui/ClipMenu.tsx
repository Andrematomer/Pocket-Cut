import { deleteClip, duplicateClip, quarterTurn, resetView, set, useStore } from '../store.ts';
import { Copy, Rotate, RotateL, Trash } from './icons.tsx';
import { Sheet } from './Sheet.tsx';

/** What a long press on a clip's thumbnail opens. */
export function ClipMenu({ onClose }: { onClose: () => void }) {
  const index = useStore((s) => s.selected);
  const done = (f: () => void) => () => {
    f();
    onClose();
  };
  return (
    <Sheet title={`Clip ${index + 1}`} onClose={onClose}>
      <div class="grid2">
        <button class="btn" onClick={done(() => quarterTurn(index))}>
          <Rotate /> Turn 90°
        </button>
        <button class="btn" onClick={done(() => resetView(index))}>
          <RotateL /> Reset position
        </button>
        <button class="btn" onClick={done(() => duplicateClip(index))}>
          <Copy /> Duplicate
        </button>
        <button class="btn danger" onClick={done(() => deleteClip(index))}>
          <Trash /> Delete clip
        </button>
      </div>
    </Sheet>
  );
}
