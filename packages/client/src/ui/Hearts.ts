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

export class Hearts {
  private readonly root = document.getElementById('hearts')!;
  private readonly hearts: HTMLElement[] = [];
  private shown = MAX_HEARTS;

  constructor() {
    for (let i = 0; i < MAX_HEARTS; i++) {
      const heart = document.createElement('div');
      heart.className = 'heart';
      heart.append(pixelSvg(FULL, 'full', PIX), pixelSvg(BROKEN, 'broken', PIX), pixelSvg(HALF, 'half', PIX));
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
