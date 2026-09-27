// Onboarding nudge: after IDLE_MS without holding an item or running a command, a banner
// across the screen says what to type, then counts itself down over SHOW_MS. Using anything
// hides it and restarts the clock. Pure DOM, driven once a frame by the Game.
import { IS_TOUCH } from '../input/touch';

const IDLE_MS = 30_000;
const SHOW_MS = 10_000;

const WHERE = IS_TOUCH ? 'in the chat (CHAT button, top right)' : 'in the chat on the bottom left';
const TEXT = `Hint: Try entering /gun or /speedy ${WHERE}. Go back to home screen and click on the guide for more info.`;

export class CommandHint {
  private readonly el = document.getElementById('command-hint')!;
  private readonly text = this.el.querySelector('.text')!;
  private readonly count = this.el.querySelector('.count')!;
  private lastUse = performance.now();
  private until: number | null = null; // showing until this time, else hidden
  private shownSeconds = -1;

  constructor() {
    this.text.textContent = TEXT;
  }

  // `active` is true while the player is using something: holding an item, boosted, or in a
  // non-standard avatar. `suppressed` (dead, chat open) freezes the whole thing.
  update(active: boolean, suppressed: boolean): void {
    const now = performance.now();
    if (active || suppressed) {
      this.lastUse = now;
      this.hide();
      return;
    }
    if (this.until === null) {
      if (now - this.lastUse >= IDLE_MS) {
        this.until = now + SHOW_MS;
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
