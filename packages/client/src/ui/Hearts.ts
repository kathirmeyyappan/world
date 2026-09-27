// The health bar: MAX_HEARTS pixel hearts in two rows at the top of the screen. Hearts you've
// lost turn grey and crack. Pure DOM, driven by the server's heart count; nothing here decides
// damage.
import { MAX_HEARTS } from '@world/shared';

// 9x8 pixel heart. '#' body, '+' highlight, '.' empty. The broken one has a crack down it.
const FULL = [
  '.##...##.',
  '#+##.####',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
];
const BROKEN = [
  '.##...##.',
  '#+##.####',
  '###.#####',
  '####.####',
  '.####.##.',
  '..##.##..',
  '...#.#...',
  '....#....',
];

export class Hearts {
  private readonly root = document.getElementById('hearts')!;
  private readonly hearts: HTMLElement[] = [];
  private shown = MAX_HEARTS;

  constructor() {
    for (let i = 0; i < MAX_HEARTS; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.append(pixelSvg(FULL, 'full'), pixelSvg(BROKEN, 'broken'));
      this.root.append(heart);
      this.hearts.push(heart);
    }
  }

  // Hearts fill from the top-left in halves: heart i is full at count >= i+1, half at
  // count >= i+0.5, else lost. A heart that just dropped a state gets the breaking animation.
  set(count: number): void {
    const n = Math.max(0, Math.min(MAX_HEARTS, count));
    if (n === this.shown) return;
    for (let i = 0; i < MAX_HEARTS; i++) {
      const heart = this.hearts[i];
      const state = n >= i + 1 ? 'full' : n >= i + 0.5 ? 'half' : 'lost';
      const was = heart.classList.contains('lost') ? 'lost' : heart.classList.contains('half') ? 'half' : 'full';
      if (state === was) continue;
      heart.classList.toggle('half', state === 'half');
      heart.classList.toggle('lost', state === 'lost');
      heart.classList.remove('breaking');
      if (state !== 'full' && (was === 'full' || state === 'lost')) {
        void heart.offsetWidth; // restart the animation
        heart.classList.add('breaking');
        heart.addEventListener('animationend', () => heart.classList.remove('breaking'), { once: true });
      }
    }
    this.shown = n;
  }
}

function pixelSvg(rows: string[], cls: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('class', cls);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      if (ch === '+') r.setAttribute('class', 'hi');
      svg.append(r);
    });
  });
  return svg;
}
