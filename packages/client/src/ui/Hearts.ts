// The health bar: MAX_HEARTS pixel hearts in two rows at the top of the screen. Hearts you've
// lost turn grey and crack. Pure DOM, driven by the server's heart count; nothing here decides
// damage.
import { MAX_HEARTS } from '@world/shared';
import { HEART as FULL, pixelSvg } from './pixelIcons';

// 9x8 pixel heart. '#' body, '+' highlight, '.' empty. The broken one has a crack down it; the
// half one is the broken one with everything left of the crack ('L') still red and the rest ('R')
// grey, so the crack is where the heart stops.
const BROKEN = ['.##...##.', '#+##.####', '###.#####', '####.####', '.####.##.', '..##.##..', '...#.#...', '....#....'];

const HALF = ['.LL...RR.', 'L+LL.RRRR', 'LLL.RRRRR', 'LLLL.RRRR', '.LLLL.RR.', '..LL.RR..', '...L.R...', '....L....'];

const PIX = { '+': 'hi', R: 'grey' };
const FILL_MS = 70; // between one heart filling and the next as hearts come back
const RANK = { lost: 0, half: 1, full: 2 };

export class Hearts {
  private readonly root = document.getElementById('hearts')!;
  private readonly hearts: HTMLElement[] = [];
  private shown = MAX_HEARTS; // what the bar shows
  private target = MAX_HEARTS; // what the server says, which a fill catches the bar up to
  private fills: number[] = [];

  constructor() {
    for (let i = 0; i < MAX_HEARTS; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.append(pixelSvg(FULL, 'full', PIX), pixelSvg(BROKEN, 'broken', PIX), pixelSvg(HALF, 'half', PIX));
      this.root.append(heart);
      this.hearts.push(heart);
    }
  }

  get count(): number {
    return this.target;
  }

  // A loss shows at once; hearts coming back fill one at a time, FILL_MS apart. Only the bar
  // takes its time: the health itself is already back.
  set(count: number): void {
    const n = Math.max(0, Math.min(MAX_HEARTS, count));
    if (n === this.target) return;
    this.target = n;
    for (const timer of this.fills) clearTimeout(timer);
    this.fills = [];
    if (n < this.shown) return this.draw(n);
    for (let v = this.shown, k = 0; v < n; k++) {
      v = Math.min(n, v + 1);
      const step = v;
      this.fills.push(window.setTimeout(() => this.draw(step), k * FILL_MS));
    }
  }

  // Hearts fill from the top-left in halves: heart i is full at count >= i+1, half at
  // count >= i+0.5, else lost. A heart that just dropped a state gets the breaking animation, one
  // that just gained one the filling one.
  private draw(n: number): void {
    for (let i = 0; i < MAX_HEARTS; i++) {
      const heart = this.hearts[i];
      const state = n >= i + 1 ? 'full' : n >= i + 0.5 ? 'half' : 'lost';
      const was = heart.classList.contains('lost') ? 'lost' : heart.classList.contains('half') ? 'half' : 'full';
      if (state === was) continue;
      heart.classList.toggle('half', state === 'half');
      heart.classList.toggle('lost', state === 'lost');
      heart.classList.remove('breaking', 'filling');
      const animation = RANK[state] > RANK[was] ? 'filling' : state !== 'full' ? 'breaking' : null;
      if (animation) {
        void heart.offsetWidth; // restart the animation
        heart.classList.add(animation);
        heart.addEventListener('animationend', () => heart.classList.remove(animation), { once: true });
      }
    }
    this.shown = n;
  }
}
