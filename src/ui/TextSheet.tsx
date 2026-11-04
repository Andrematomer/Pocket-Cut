import { useState } from 'preact/hooks';
import { addText, getState, set } from '../store.ts';
import { TEXT_COLORS } from '../text.ts';
import { Sheet } from './Sheet.tsx';

/** Make a text clip, or change the text of one. */
export function TextSheet({ onClose }: { onClose: () => void }) {
  const editing = getState().textEdit;
  const media = editing !== null ? getState().project.media[getState().project.clips[editing]?.mediaId ?? ''] : undefined;
  const [text, setText] = useState(media?.text ?? '');
  const [color, setColor] = useState(media?.textColor ?? TEXT_COLORS[0]);
  const done = () => {
    void addText(text, color, editing);
    set({ textEdit: null });
    onClose();
  };
  return (
    <Sheet title={editing !== null ? 'Edit text' : 'Add text'} onClose={onClose}>
      <section>
        <textarea class="name-field text-field" rows={3} value={text} placeholder="Type here" autofocus onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)} aria-label="Text" />
      </section>
      <section>
        <h3>Color</h3>
        <div class="chips" role="group" aria-label="Text color">
          {TEXT_COLORS.map((c) => (
            <button key={c} class={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} aria-label={c} aria-pressed={c === color} onClick={() => setColor(c)} />
          ))}
        </div>
        <p class="hint">After adding, place and size it on the preview like any picture, and drag its strip on the timeline to time it.</p>
      </section>
      <button class="cta" disabled={!text.trim()} onClick={done}>
        {editing !== null ? 'Update' : 'Add text'}
      </button>
    </Sheet>
  );
}
