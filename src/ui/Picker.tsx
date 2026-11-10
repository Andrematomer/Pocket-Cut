import type { ComponentChildren } from 'preact';
import { ACCEPT, PICKER_ID, onPicked, pickVideos, setPickMode } from '../files.ts';

/** The one file input of the app. Always in the page, hidden but not display:none. */
export function FilePicker() {
  return <input id={PICKER_ID} class="pick-input" type="file" accept={ACCEPT} multiple tabIndex={-1} onChange={(e) => onPicked(e.currentTarget as HTMLInputElement)} />;
}

/** A button that opens the picker. A <label> for the input, so the tap itself opens the system dialog. */
export function PickLabel({ class: cls, label, mode = 'end', children }: { class: string; label?: string; mode?: 'end' | 'playhead'; children: ComponentChildren }) {
  return (
    <label
      htmlFor={PICKER_ID}
      class={`${cls} pick-label`}
      {...({ role: "button" } as object)}
      tabIndex={0}
      aria-label={label}
      onClick={() => setPickMode(mode)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setPickMode(mode);
          pickVideos();
        }
      }}
    >
      {children}
    </label>
  );
}
