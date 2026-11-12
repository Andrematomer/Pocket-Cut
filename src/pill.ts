/**
 * Segmented values (the Ratio, quality, frame rate... rows): the yellow highlight is one piece that slides to the
 * value you pick, with a little spring at the end. The buttons themselves stay plain; this only measures where the
 * selected one is and hands the numbers to the CSS (see `.pill::before`).
 */
const SELECTOR = '.seg, .sheet .chips';

function place(c: HTMLElement): void {
  const on = c.querySelector(':scope > .on') as HTMLElement | null;
  if (!on || !(on.classList.contains('chip') || on.tagName === 'BUTTON') || on.classList.contains('swatch')) {
    c.classList.remove('pill');
    return;
  }
  const first = !c.classList.contains('pill');
  c.style.setProperty('--px', `${on.offsetLeft}px`);
  c.style.setProperty('--py', `${on.offsetTop}px`);
  c.style.setProperty('--pw', `${on.offsetWidth}px`);
  c.style.setProperty('--ph', `${on.offsetHeight}px`);
  c.style.setProperty('--pr', getComputedStyle(on).borderRadius);
  c.classList.add('pill');
  // the first placement jumps into position; later ones slide
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('pill-ready')));
}

export function startPills(): void {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach(place);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', queue);
  queue();
}
