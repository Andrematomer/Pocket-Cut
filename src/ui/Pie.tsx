/** A small progress pie. `value` is 0..1. */
export function Pie({ value, size = 18 }: { value: number; size?: number }) {
  const deg = Math.max(0.04, Math.min(1, value)) * 360;
  return <span class="pie" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} style={{ width: `${size}px`, height: `${size}px`, background: `conic-gradient(var(--accent) ${deg}deg, rgba(255,255,255,0.22) 0)` }} />;
}
