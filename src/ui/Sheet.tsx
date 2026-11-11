import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="scrim">
      <div class="sheet" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
