import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * When `key` changes between two real values, the old content slides down and fades (swap-out) FIRST,
 * and only then the new content takes its place and slides back up (swap-in). Going from or to
 * "nothing" (key '') changes at once: that is an opening or closing, which has its own animation.
 */
export function useSwap<T>(value: T, key: string, ms = 120): { shown: T; cls: string } {
  const [st, setSt] = useState<{ key: string; phase: '' | 'in' }>({ key, phase: '' });
  const last = useRef(value);
  const latest = useRef(value);
  latest.current = value;
  const pending = st.key !== key;
  const direct = pending && (st.key === '' || key === '');
  useEffect(() => {
    if (st.key === key) return;
    if (direct) return setSt({ key, phase: '' });
    // old content has been sliding down since this very render; swap it when it is gone
    const a = window.setTimeout(() => setSt({ key, phase: 'in' }), ms);
    return () => clearTimeout(a);
  }, [key, st.key]);
  useEffect(() => {
    if (st.phase !== 'in') return;
    const b = window.setTimeout(() => setSt((s) => ({ ...s, phase: '' })), ms + 30);
    return () => clearTimeout(b);
  }, [st.phase, st.key]);
  if (pending && !direct) return { shown: last.current, cls: 'swap-out' };
  last.current = value;
  return { shown: value, cls: st.phase === 'in' ? 'swap-in' : '' };
}
