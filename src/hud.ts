/**
 * The capsule on top of the preview: says what just happened ("Undo", "Split", "Edit mode"...) or what a held action is doing
 * ("Trim 1.20 s", "Crop 12%"). A one-off message stays about a second; a held one stays until the finger lets go, and
 * every message stays at least a moment, so it never flashes for a single frame.
 */
const MIN_MS = 750;
let timer = 0;
let minUntil = 0;
let holding = false;

const el = (): HTMLElement | null => document.querySelector('.gesture-badge');
const isFine = (b: HTMLElement) => b.textContent === 'FINE';

function clear(): void {
  const b = el();
  if (!b || holding || isFine(b)) return;
  b.textContent = '';
  b.classList.remove('on');
}

/** a one-off message */
export function say(text: string, ms = 1100): void {
  const b = el();
  if (!b || isFine(b)) return;
  holding = false;
  b.textContent = text;
  b.classList.add('on');
  clearTimeout(timer);
  minUntil = performance.now() + Math.min(ms, MIN_MS);
  timer = window.setTimeout(clear, ms);
}

/** a message that follows an action that is still going on: call again to change the text, `release()` when it ends */
export function hold(text: string): void {
  const b = el();
  if (!b || isFine(b)) return;
  if (!holding) minUntil = performance.now() + MIN_MS;
  holding = true;
  clearTimeout(timer);
  b.textContent = text;
  b.classList.add('on');
}

export function release(): void {
  if (!holding) return;
  holding = false;
  clearTimeout(timer);
  timer = window.setTimeout(clear, Math.max(250, minUntil - performance.now()));
}
