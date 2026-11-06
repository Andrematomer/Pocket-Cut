import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** An explanation that stays folded until asked for, so the settings pages stay short. */
export function Hint({ children, num }: { children: ComponentChildren; num?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="more">
      <button class="more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Read less' : 'Read more'} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <p class={`hint ${num ? 'num' : ''}`}>{children}</p>}
    </div>
  );
}
