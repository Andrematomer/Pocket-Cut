/** The screen is turned a quarter in code (full preview, phone held on its side): touch points must be turned back. */
let quarter: 0 | 90 | -90 = 0;
export const setQuarter = (q: 0 | 90 | -90) => void (quarter = q);

/** A touch point inside an element, in the element's own (unturned) pixels. `r` is its bounding box on screen. */
export function localPoint(r: DOMRect, cx: number, cy: number): { x: number; y: number } {
  if (quarter === 90) return { x: cy - r.top, y: r.right - cx };
  if (quarter === -90) return { x: r.bottom - cy, y: cx - r.left };
  return { x: cx - r.left, y: cy - r.top };
}
