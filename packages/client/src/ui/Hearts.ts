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

  // Hearts fill from the top-left; the ones past `count` are lost. A heart that just went
  // gets the breaking animation.
  set(count: number): void {
    const n = Math.max(0, Math.min(MAX_HEARTS, count));
    if (n === this.shown) return;
    for (let i = 0; i < MAX_HEARTS; i++) {
      const lost = i >= n;
      const heart = this.hearts[i];
      if (lost && !heart.classList.contains('lost')) {
        heart.classList.add('lost', 'breaking');
        heart.addEventListener('animationend', () => heart.classList.remove('breaking'), { once: true });
      } else if (!lost) heart.classList.remove('lost', 'breaking');
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
