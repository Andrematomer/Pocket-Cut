import { useState } from 'preact/hooks';
import { addText, getState, loadTextStyle, set } from '../store.ts';
import { TEXT_COLORS, TEXT_FONTS } from '../text.ts';
import { Sheet } from './Sheet.tsx';

/** Make a text clip, or change the text of one. */
export function TextSheet({ onClose }: { onClose: () => void }) {
  const editing = getState().textEdit;
  const media = editing !== null ? getState().project.media[getState().project.clips[editing]?.mediaId ?? ''] : undefined;
  const [text, setText] = useState(media?.text ?? '');
  const last = loadTextStyle();
  const [color, setColor] = useState<string>(media?.textColor ?? last.color);
  const [font, setFont] = useState<string>(media?.textFont ?? last.font);
  const done = () => {
    void addText(text, color, font, editing);
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
      </section>
      <section>
        <h3>Font</h3>
        <div class="chips" role="group" aria-label="Font">
          {TEXT_FONTS.map((f) => (
            <button key={f.key} class={`chip ${f.key === font ? 'on' : ''}`} style={{ fontFamily: f.css, fontWeight: f.weight }} aria-pressed={f.key === font} onClick={() => setFont(f.key)}>
              {f.name}
            </button>
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
