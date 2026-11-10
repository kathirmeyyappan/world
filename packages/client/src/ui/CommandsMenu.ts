// The commands card: every chat command (commands.ts) as a button. Toggled with C or the touch
// button, it frees the mouse, as the menu does, so a button can be clicked; a button sends its
// command as a chat message and the card goes, so what it did is in view, and one that needs
// arguments is greyed and opens chat with it typed, to finish there. Q or C closes it, as does a
// click beside the card or, on touch, any tap. Blocks game input while open, like the cube card.
import { IS_TOUCH, onTap } from '../input/touch';
import { commandGroups, type Group } from './commands';
import { railScroll } from './scrollRail';

const NOTICE_MS = 2600; // how long a greyed button's notice stays up

export class CommandsMenu {
  private readonly el = document.getElementById('commands')!;
  private open = false;
  private readonly noticeEl = document.createElement('div');
  private noticeTimer = 0;
  onCommand: ((text: string) => void) | null = null;
  onDraft: ((text: string) => void) | null = null; // opens chat with this typed
  onOpenChange: ((open: boolean) => void) | null = null;

  constructor() {
    // The body scrolls; the footer (guide note + close hint) stays put under it.
    this.el.innerHTML = cardHtml(commandGroups());
    railScroll(this.el.querySelector<HTMLElement>('.body')!);
    if (IS_TOUCH) {
      // Every tap closes the card, a button's after it has done its work. The tap hides the card on
      // its up, so the mouse events the browser follows it with would land on the world beneath
      // (taking focus from the chat a greyed button opens); swipes still scroll.
      onTap(this.el, (e) => {
        const button = e.target instanceof Element ? e.target.closest<HTMLElement>('.cmd-button') : null;
        if (button) this.press(button);
        else this.set(false);
      });
      this.el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') e.preventDefault();
      });
    } else {
      this.el.addEventListener('click', (e) => {
        const button = e.target instanceof Element ? e.target.closest<HTMLElement>('.cmd-button') : null;
        if (button) this.press(button);
        else if (e.target === this.el) this.set(false); // beside the card: back to the world
      });
    }
    // Outside the card, so it stays up over the chat a greyed button opens.
    this.noticeEl.id = 'command-notice';
    document.body.append(this.noticeEl);
  }

  get isOpen(): boolean {
    return this.open;
  }

  // The card is a little page: the arrows and W/S scroll it from the keyboard (Game.ts).
  scroll(dy: number): void {
    this.el.querySelector('.body')?.scrollBy({ top: dy });
  }

  toggle(): void {
    this.set(!this.open);
  }

  set(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.el.classList.toggle('hidden', !open);
    if (open && document.pointerLockElement) document.exitPointerLock(); // the mouse is free over the card
    this.onOpenChange?.(open);
  }

  // A button sends its command, the card going first so what the command did is in view; a greyed
  // one opens chat with it typed, before the card goes so the mouse stays free for the typing, and
  // says to add the options there.
  private press(button: HTMLElement): void {
    const text = button.dataset.tap;
    if (!text) return;
    if (!('needsArgs' in button.dataset)) {
      this.set(false);
      this.onCommand?.(text);
      return;
    }
    this.onDraft?.(text);
    this.set(false);
    this.noticeEl.textContent = 'add the options in chat, then send';
    this.noticeEl.classList.add('on');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('on'), NOTICE_MS);
  }
}

function cardHtml(groups: Group[]): string {
  const sections = groups.map((g) => {
    const buttons = g.rows.map((r) => {
      const label = r.label.split(', ')[0];
      const args = r.args ? `<span class="args" translate="no">${r.args}</span>` : '';
      return `<button class="cmd-button${r.needsArgs ? ' needs-args' : ''}" data-tap="${r.tap}"${r.needsArgs ? ' data-needs-args' : ''}>
        <span class="cmd" translate="no">${label}</span>${args}<span class="note">${r.note}</span></button>`;
    });
    return `<section><h2>${g.title}</h2><div class="buttons">${buttons.join('')}</div></section>`;
  });
  const how = IS_TOUCH ? 'tap to use' : 'click to use';
  const guide = IS_TOUCH ? 'MORE IN THE GUIDE, IN THE MENU' : 'MORE IN THE GUIDE: PRESS X FOR THE MENU';
  const close = IS_TOUCH ? 'TAP TO EXIT' : 'PRESS <kbd>Q</kbd> TO CLOSE';
  return `
    <div class="card">
      <div class="scroller">
        <div class="body">
          <h1>COMMANDS</h1>
          <p class="how">${how}<span class="or">or type any of these in chat, options and all</span></p>
          <div class="groups">${sections.join('')}</div>
        </div>
      </div>
      <div class="footer">
        <div class="guide">${guide}</div>
        <div class="close-hint">${close}<span class="cursor">▮</span></div>
      </div>
    </div>`;
}
