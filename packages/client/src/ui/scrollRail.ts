// A bar beside anything that scrolls: a rail inside the right edge of its frame, as tall as the
// part in view, with a thumb for the part in view and arrows at its ends, the bottom one blinking
// while there's more below. It stands in for the browser's own bar (hidden: a Mac's comes and goes,
// a phone's lies over the page), there whenever there's more than fits, in the room the frame's
// right padding keeps for it (styles.css), clear of what's in the frame. The thumb drags, a press
// on the track pages that way, an arrow steps, and the wheel and the keys scroll as before.
// `frame` is the bordered box round `el`, positioned, whose scrolling part `el` is; the frame's
// overlay is told nothing of a press on the rail (its taps close the cards).
const STEP = 80; // pixels an arrow press scrolls
const MIN_THUMB = 16; // pixels: a thumb for a long page still has something to take hold of

export function railScroll(el: HTMLElement, frame: HTMLElement): void {
  const rail = document.createElement('div');
  rail.className = 'scroll-rail';
  rail.innerHTML =
    '<button class="arrow up">▲</button><div class="track"><div class="thumb"></div></div><button class="arrow down">▼</button>';
  frame.append(rail);
  const track = rail.querySelector<HTMLElement>('.track')!;
  const thumb = rail.querySelector<HTMLElement>('.thumb')!;
  const [up, down] = rail.querySelectorAll<HTMLElement>('.arrow');

  const update = () => {
    const more = el.scrollHeight - el.clientHeight;
    const on = more > 1 && el.clientHeight > 0;
    rail.classList.toggle('on', on);
    if (!on) return;
    const f = frame.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    rail.style.top = `${e.top - f.top - frame.clientTop}px`;
    rail.style.height = `${e.height}px`;
    const room = track.clientHeight;
    const size = Math.max(MIN_THUMB, (room * el.clientHeight) / el.scrollHeight);
    thumb.style.height = `${size}px`;
    thumb.style.top = `${(el.scrollTop / more) * (room - size)}px`;
    up.classList.toggle('more', el.scrollTop > 1);
    down.classList.toggle('more', more - el.scrollTop > 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  new ResizeObserver(update).observe(el); // shown or hidden too: a hidden element has no size
  new MutationObserver(update).observe(el, { childList: true, subtree: true, attributeFilter: ['class', 'style'] });
  update();

  for (const type of ['pointerdown', 'pointerup', 'click'] as const) {
    rail.addEventListener(type, (e) => e.stopPropagation());
  }
  up.addEventListener('click', () => el.scrollBy({ top: -STEP }));
  down.addEventListener('click', () => el.scrollBy({ top: STEP }));
  track.addEventListener('click', (e) => {
    if (e.target === thumb) return;
    const t = thumb.getBoundingClientRect();
    el.scrollBy({ top: e.clientY < t.top ? -el.clientHeight : el.clientHeight });
  });
  let drag: { y: number; top: number } | null = null;
  thumb.addEventListener('pointerdown', (e) => {
    thumb.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, top: el.scrollTop };
    e.preventDefault();
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const run = track.clientHeight - thumb.offsetHeight; // pixels the thumb can travel
    if (run > 0) el.scrollTop = drag.top + ((e.clientY - drag.y) * (el.scrollHeight - el.clientHeight)) / run;
  });
  thumb.addEventListener('pointerup', () => (drag = null));
  thumb.addEventListener('pointercancel', () => (drag = null));
}
