// Whether this is a touch device. Decided once at load; the touch UI (pad, buttons) and the
// keyboard hints are mutually exclusive on it.
export const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// A finger tap on `el`: down and up within a few pixels. A swipe (scrolling a card) is not a
// tap, and a mouse never is, so desktop keeps its keys and click-outside. Fires on the up.
const TAP_SLOP_PX = 12;
export function onTap(el: HTMLElement, handler: () => void): void {
  let start: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    start = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null;
  });
  el.addEventListener('pointerup', (e) => {
    if (!start || e.pointerType !== 'touch') return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    start = null;
    if (moved <= TAP_SLOP_PX) handler();
  });
  el.addEventListener('pointercancel', () => (start = null));
}
