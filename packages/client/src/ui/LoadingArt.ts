// The loading screen's pixel art: Elizabeth above the title, turning to face the other way and back,
// and the Modal mark in the "POWERED BY MODAL" line under it. Both are bitmaps in pixelIcons.ts.
//
// Elizabeth's turn is a strip of frames drawn once onto a canvas, each her bitmap squeezed sideways
// about her middle (to nothing and out again mirrored), and the strip slides past a one-frame window
// in steps. A transform animation keeps playing while the game's own loading holds up the page.
import { ELIZABETH, MODAL_LOGO, pixelSvg } from './pixelIcons';

const COLORS: Record<string, string> = { k: '#141414', c: '#fffce6', w: '#ffffff', o: '#f5be5a' };
const TURN = 8; // frames between facing one way and the other
const HOLD = 8; // frames she stands facing each way
const FRAME_MS = 70;

export function mountLoadingArt(): void {
  const loading = document.getElementById('loading');
  if (!loading || loading.classList.contains('ready')) return;
  const mascot = loading.querySelector<HTMLElement>('.mascot');
  if (mascot) {
    const strip = turnStrip(ELIZABETH);
    mascot.style.aspectRatio = `${ELIZABETH[0].length} / ${ELIZABETH.length}`;
    mascot.append(strip.canvas);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      strip.canvas.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }], {
        duration: strip.frames * FRAME_MS,
        iterations: Infinity,
        easing: `steps(${strip.frames})`,
      });
  }
  loading.querySelector('.powered')?.append(pixelSvg(MODAL_LOGO, 'modal-logo', { d: 'd' }));
  loading.classList.add('ready');
}

// The turn as frames side by side: facing as drawn, turning, facing the other way, turning back.
// Each is the bitmap's columns sampled at a horizontal scale, cos(0) to cos(π) across a turn.
function turnStrip(rows: string[]): { canvas: HTMLCanvasElement; frames: number } {
  const w = rows[0].length;
  const h = rows.length;
  const turn = Array.from({ length: TURN }, (_, k) => Math.cos((Math.PI * (k + 1)) / (TURN + 1)));
  const scales = [...Array<number>(HOLD).fill(1), ...turn, ...Array<number>(HOLD).fill(-1), ...[...turn].reverse()];
  // She turns about the middle of what's drawn, not of the bitmap.
  const used = [...Array(w).keys()].filter((x) => rows.some((row) => row[x] !== '.'));
  const middle = (used[0] + used[used.length - 1] + 1) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = w * scales.length;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  scales.forEach((s, f) => {
    for (let x = 0; x < w; x++) {
      const col = Math.floor(middle + (x + 0.5 - middle) / s);
      if (col < 0 || col >= w) continue;
      rows.forEach((row, y) => {
        const color = COLORS[row[col]];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(f * w + x, y, 1, 1);
      });
    }
  });
  return { canvas, frames: scales.length };
}
