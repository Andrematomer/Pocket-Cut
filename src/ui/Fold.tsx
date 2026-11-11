import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** A heading that folds its explanation open and shut (with a short slide). The controls stay visible. */
export function Fold({ title, hint, children }: { title: string; hint: ComponentChildren; children?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button class="fold-title" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <i class={open ? 'open' : ''} aria-hidden="true">▾</i>
      </button>
      <div class={`fold-body ${open ? 'open' : ''}`}>
        <div>
          <p class="hint">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** A heading whose whole content folds open and shut. */
export function Collapse({ title, children, open: ctl, onToggle }: { title: string; children: ComponentChildren; open?: boolean; onToggle?: () => void }) {
  const [own, setOwn] = useState(false);
  const open = ctl ?? own;
  const setOpen = (_: boolean) => (onToggle ? onToggle() : setOwn(!own));
  return (
    <div class="collapse">
      <button class="fold-title big" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <i class={open ? 'open' : ''} aria-hidden="true">▾</i>
      </button>
      <div class={`fold-body ${open ? 'open' : ''}`}>
        <div>{children}</div>
      </div>
    </div>
  );
}
