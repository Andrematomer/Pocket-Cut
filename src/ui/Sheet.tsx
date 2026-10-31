import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { Close } from './icons.tsx';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button class="icon" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
