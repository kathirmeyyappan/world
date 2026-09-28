// Onboarding nudge: after IDLE_MS without holding an item, sending a command or opening the
// commands menu, a banner across the screen points at the menu, then counts itself down (FIRST_SHOW_MS the first time,
// SHOW_MS after). Once the player has used anything, the tab remembers and never nags again,
// across the reload a death causes. Pure DOM, driven once a frame by the Game.
import { IS_TOUCH } from '../input/touch';

const IDLE_MS = 8_000; // inside the first ten seconds of play
const FIRST_SHOW_MS = 8_000;
const SHOW_MS = 5_000;
const DONE_KEY = 'world.hint-done'; // sessionStorage: this tab has used an item

const TEXT = IS_TOUCH
  ? 'Hint: tap CMDS (top right) for the list of commands: weapons, skins and more. Type them in the chat.'
  : 'Hint: press C for the list of commands: weapons, skins and more. Enter opens the chat to type them.';

export class CommandHint {
  private readonly el = document.getElementById('command-hint')!;
  private readonly text = this.el.querySelector('.text')!;
  private readonly count = this.el.querySelector('.count')!;
  private lastUse = performance.now();
  private until: number | null = null; // showing until this time, else hidden
  private shownSeconds = -1;
  private shows = 0;
  private done = read(DONE_KEY);

  constructor() {
    this.text.textContent = TEXT;
  }

  // Something the player did counts as knowing the ropes: the hint is off for good in this tab.
  markUsed(): void {
    if (this.done) return;
    this.done = true;
    write(DONE_KEY);
    this.hide();
  }

  // `active` is true while the player is using something: holding an item, boosted, in a
  // non-standard avatar, or has opened the menu. `suppressed` (dead, chat open) freezes the
  // whole thing.
  update(active: boolean, suppressed: boolean): void {
    if (this.done) return;
    const now = performance.now();
    if (active) {
      this.markUsed();
      return;
    }
    if (suppressed) {
      this.lastUse = now;
      this.hide();
      return;
    }
    if (this.until === null) {
      if (now - this.lastUse >= IDLE_MS) {
        this.until = now + (this.shows === 0 ? FIRST_SHOW_MS : SHOW_MS);
        this.shows++;
        this.el.classList.add('on');
      }
      return;
    }
    if (now >= this.until) {
      this.hide();
      this.lastUse = now;
      return;
    }
    const seconds = Math.ceil((this.until - now) / 1000);
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      this.count.textContent = `Message disappearing in ${seconds}s`;
    }
  }

  private hide(): void {
    if (this.until === null) return;
    this.until = null;
    this.shownSeconds = -1;
    this.el.classList.remove('on');
  }
}

function read(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key: string): void {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // private mode or blocked storage: the hint just comes back after a reload
  }
}
