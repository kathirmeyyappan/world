// The health bar: a life's worth of pixel hearts in rows at the top of the screen, as many as the
// worn look has (classes.ts `lifeOf`), drawn as its life says: hearts, or the big crystals of a
// dragon with a crystal a segment. Hearts you've lost turn grey and crack. Pure DOM, driven by the
// server's heart count; nothing here decides damage.
import { WALKER, type HeartSprite, type LifeSpec } from '@world/shared';
import { HEART as FULL, pixelSvg } from './pixelIcons';

// 9x8 pixel heart. '#' body, '+' highlight, '.' empty. The broken one has a crack down it; the
// half one is the broken one with everything left of the crack ('L') still red and the rest ('R')
// grey, so the crack is where the heart stops.
const BROKEN = ['.##...##.', '#+##.####', '###.#####', '####.####', '.####.##.', '..##.##..', '...#.#...', '....#....'];

const HALF = ['.LL...RR.', 'L+LL.RRRR', 'LLL.RRRRR', 'LLLL.RRRR', '.LLLL.RR.', '..LL.RR..', '...L.R...', '....L....'];

// 15x13 pixel crystal heart, cut like a gem: '#' its edges, '+' the light on the crown above the
// girdle ('=' the facet lines, '*' the glint on it), 'o' the pavilion facets below in shade. A lost
// one is shattered, a crack zigzagging down it; it is never half.
const CRYSTAL = [
  '..####...####..',
  '.#+*++#.#++++#.',
  '#+*+++=#=+++++#',
  '#+++++=+=+++++#',
  '#=============#',
  '#oo+++++++++oo#',
  '.#oo=+++++=oo#.',
  '..#oo=+++=oo#..',
  '...#oo=+=oo#...',
  '....#oo=oo#....',
  '.....#ooo#.....',
  '......#o#......',
  '.......#.......',
];
const CRYSTAL_BROKEN = [
  '..####...####..',
  '.#+*++#.#++++#.',
  '#+*+++=#=+++++#',
  '#+++++=.=+++++#',
  '#=====.=======#',
  '#oo+++.+++++oo#',
  '.#oo=++.++=oo#.',
  '..#oo=+.+=oo#..',
  '...#oo.+=oo#...',
  '....#o.=oo#....',
  '.....#.oo#.....',
  '......#.#......',
  '.......#.......',
];

const SPRITES: Record<HeartSprite, { full: string[]; broken: string[]; half: string[]; pix: Record<string, string> }> =
  {
    heart: { full: FULL, broken: BROKEN, half: HALF, pix: { '+': 'hi', R: 'grey' } },
    crystal: {
      full: CRYSTAL,
      broken: CRYSTAL_BROKEN,
      half: CRYSTAL_BROKEN,
      pix: { '+': 'hi', o: 'shade', '=': 'facet', '*': 'glint' },
    },
  };
const FILL_MS = 70; // between one heart filling and the next as hearts come back
const RANK = { lost: 0, half: 1, full: 2 };
type State = keyof typeof RANK;

export class Hearts {
  private readonly root = document.getElementById('hearts')!;
  private hearts: HTMLElement[] = [];
  private max = 0; // a full life for the worn look
  private sprite: HeartSprite | null = null;
  private shown = 0; // what the bar shows
  private target = 0; // what the server says, which a fill catches the bar up to
  private fills: number[] = [];

  constructor() {
    this.setLife(WALKER.life);
  }

  get count(): number {
    return this.target;
  }

  // The bar for `life`'s hearts in its rows, full when that changes (a new look).
  setLife(life: LifeSpec): void {
    if (life.hearts === this.max && life.sprite === this.sprite) return;
    const art = SPRITES[life.sprite];
    this.root.replaceChildren();
    this.root.style.setProperty('--heart-row', String(life.row));
    this.root.dataset.sprite = life.sprite;
    this.hearts = [];
    for (let i = 0; i < life.hearts; i++) {
      const heart = document.createElement('div');
      heart.className = `heart ${life.sprite}`;
      heart.append(
        pixelSvg(art.full, 'full', art.pix),
        pixelSvg(art.broken, 'broken', art.pix),
        pixelSvg(art.half, 'half', art.pix),
      );
      this.root.append(heart);
      this.hearts.push(heart);
    }
    this.max = this.shown = this.target = life.hearts;
    this.sprite = life.sprite;
  }

  // A loss shows at once; hearts coming back fill one at a time, FILL_MS apart. Only the bar
  // takes its time: the health itself is already back.
  set(count: number): void {
    const n = Math.max(0, Math.min(this.max, count));
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
    for (let i = 0; i < this.max; i++) {
      const heart = this.hearts[i];
      const state: State = n >= i + 1 ? 'full' : n >= i + 0.5 ? 'half' : 'lost';
      const was: State = heart.classList.contains('lost') ? 'lost' : heart.classList.contains('half') ? 'half' : 'full';
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
