// The loading screen's pixel art: Elizabeth above the title, walking on the spot, and the Modal mark
// in the "POWERED BY MODAL" line under it. Both are bitmaps in pixelIcons.ts.
//
// Her walk is a strip of frames drawn once onto a canvas, sliding past a one-frame window in steps:
// a transform animation keeps playing while the game's own loading holds up the page.
import { ELIZABETH, ELIZABETH_STEP, MODAL_LOGO, pixelSvg } from './pixelIcons';

const COLORS: Record<string, string> = { k: '#141414', c: '#fffce6', w: '#ffffff', o: '#f5be5a' };
const FRAME_MS = 90;
const MIDDLE = 17; // the column her body is centred on, which her mirror image is taken about

export function mountLoadingArt(): void {
  const loading = document.getElementById('loading');
  if (!loading || loading.classList.contains('ready')) return;
  const mascot = loading.querySelector<HTMLElement>('.mascot');
  if (mascot) {
    const frames = walk();
    mascot.style.aspectRatio = `${ELIZABETH[0].length} / ${ELIZABETH.length}`;
    const canvas = strip(frames);
    mascot.append(canvas);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      canvas.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], {
        duration: frames.length * FRAME_MS,
        iterations: Infinity,
        easing: `steps(${frames.length})`,
      });
  }
  loading.querySelector('.powered')?.append(pixelSvg(MODAL_LOGO, 'modal-logo', { d: 'd' }));
  loading.classList.add('ready');
}

// One step to her mirror image (her step to the passing frame, then the same mirrored in reverse) and
// the next step back to where she started.
function walk(): string[][] {
  const passing = ELIZABETH_STEP.length - 1;
  const across = [
    ELIZABETH,
    ...ELIZABETH_STEP,
    ...ELIZABETH_STEP.slice(0, passing).reverse().map(mirror),
    mirror(ELIZABETH),
  ];
  return [...across, ...across.slice(1, -1).reverse()];
}

function mirror(rows: string[]): string[] {
  return rows.map((row) => [...row].map((_, x) => row[2 * MIDDLE - x] ?? '.').join(''));
}

// The frames side by side on one canvas, a pixel per bitmap cell.
function strip(frames: string[][]): HTMLCanvasElement {
  const w = frames[0][0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w * frames.length;
  canvas.height = frames[0].length;
  const ctx = canvas.getContext('2d')!;
  frames.forEach((rows, f) =>
    rows.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        const color = COLORS[cell];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(f * w + x, y, 1, 1);
      }),
    ),
  );
  return canvas;
}
