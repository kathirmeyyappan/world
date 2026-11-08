// Onboarding nudge: a banner across the screen pointing at the commands (C) and the game info and
// settings menu (X), its keys tapping down and up in turn. It comes up once, DELAY_MS into play, and
// counts itself down for SHOW_MS; after that, or once the player has opened chat, the commands or
// the menu, whichever comes first, it's retired and this device never shows it again. Pure DOM,
// driven once a frame by the Game.
import { IS_TOUCH } from '../input/touch';
import { GEAR, pixelSvg } from './pixelIcons';

const DELAY_MS = 12_000; // from the press that starts play
const SHOW_MS = 10_000;
const DONE_KEY = 'world.hint-done'; // localStorage: this device is done with the nudge

// The keys are drawn like the Q in the windows' close hints; on touch they're the buttons to tap.
const LINES = IS_TOUCH
  ? ['TAP <kbd>CMDS</kbd> FOR COMMANDS', 'TAP <kbd class="gear-key"></kbd> FOR MENU']
  : ['PRESS <kbd>C</kbd> FOR COMMANDS', 'PRESS <kbd>X</kbd> FOR MENU'];

export class CommandHint {
  private readonly el = document.getElementById('command-hint')!;
  private readonly count = this.el.querySelector('.count')!;
  private from = performance.now(); // when play started, as far as the delay is concerned
  private until: number | null = null; // showing until this time, else not up yet
  private shownSeconds = -1;
  private done = read(DONE_KEY);

  constructor() {
    const text = this.el.querySelector('.text')!;
    text.innerHTML = LINES.map((line) => `<span class="line">${line}</span>`).join('');
    text.querySelector('.gear-key')?.append(pixelSvg(GEAR, 'gear'));
  }

  // Off for good on this device, and gone now if it's up.
  retire(): void {
    if (this.done) return;
    this.done = true;
    write(DONE_KEY);
    this.el.classList.remove('on');
  }

  // `busy` (dead, a card up) holds it back once its delay is over, until the player is free.
  update(busy: boolean): void {
    if (this.done) return;
    const now = performance.now();
    if (this.until === null) {
      // The world waits behind the start press (main.ts showStart), which takes #start away.
      if (document.getElementById('start')) this.from = now;
      else if (!busy && now - this.from >= DELAY_MS) {
        this.until = now + SHOW_MS;
        this.el.classList.add('on');
      }
      return;
    }
    if (now >= this.until) return this.retire();
    const seconds = Math.ceil((this.until - now) / 1000);
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      this.count.textContent = `Message disappearing in ${seconds}s`;
    }
  }
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Storage blocked: the nudge comes back on the next page.
  }
}
