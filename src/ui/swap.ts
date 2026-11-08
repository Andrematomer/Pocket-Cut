import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * When `key` changes between two real values, the old content slides down and fades (class swap-out),
 * THEN the new content takes its place and slides back up (swap-in). Going from or to "nothing" (key
 * '') changes at once: that is an opening or closing, which has its own animation.
 */
export function useSwap<T>(value: T, key: string, ms = 120): { shown: T; cls: string } {
  const [st, setSt] = useState<{ phase: '' | 'out' | 'in'; shown: T }>({ phase: '', shown: value });
  const last = useRef({ key, value });
  const latest = useRef(value);
  latest.current = value;
  const prevKey = useRef(key);
  useEffect(() => {
    const was = prevKey.current;
    prevKey.current = key;
    if (was === key) return;
    if (was === '' || key === '') {
      setSt({ phase: '', shown: value });
      return;
    }
    setSt({ phase: 'out', shown: last.current.value });
    const a = window.setTimeout(() => setSt({ phase: 'in', shown: latest.current }), ms);
    const b = window.setTimeout(() => setSt({ phase: '', shown: latest.current }), ms * 2 + 30);
    return () => (clearTimeout(a), clearTimeout(b));
  }, [key]);
  if (st.phase === '') last.current = { key, value };
  return { shown: st.phase === '' ? value : st.shown, cls: st.phase ? `swap-${st.phase}` : '' };
}
