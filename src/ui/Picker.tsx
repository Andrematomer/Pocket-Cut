import type { ComponentChildren } from 'preact';
import { ACCEPT, PICKER_ID, onPicked, pickVideos } from '../files.ts';

/** The one file input of the app. Always in the page, hidden but not display:none. */
export function FilePicker() {
  return <input id={PICKER_ID} class="pick-input" type="file" accept={ACCEPT} multiple tabIndex={-1} onChange={(e) => onPicked(e.currentTarget as HTMLInputElement)} />;
}

/** A button that opens the picker. A <label> for the input, so the tap itself opens the system dialog. */
export function PickLabel({ class: cls, label, children }: { class: string; label?: string; children: ComponentChildren }) {
  return (
    <label
      htmlFor={PICKER_ID}
      class={`${cls} pick-label`}
      {...({ role: "button" } as object)}
      tabIndex={0}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickVideos();
        }
      }}
    >
      {children}
    </label>
  );
}
