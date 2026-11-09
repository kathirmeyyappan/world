// The commands menu: every chat command, grouped, built from the item, gear and avatar registries so
// a new item or skin shows up here without anyone remembering to add it. Toggled with a key
// or the touch button, closed with Q/C or, on touch, any tap. On a keyboard it is a reference
// card; on touch each command is a button that sends it as a chat message, and one that needs
// arguments is greyed and opens chat with it typed, to finish there.
// Blocks game input while open, like the cube card.
import {
  AVATARS,
  AVATAR_IDS,
  BOTS,
  BOT_IDS,
  COMMAND_SHORTCUTS,
  GEAR,
  GEAR_IDS,
  ITEMS,
  ITEM_IDS,
  botArguments,
} from '@world/shared';
import { IS_TOUCH, onTap } from '../input/touch';

interface Row {
  label: string; // the command and its shortcuts, as shown
  note: string;
  args?: string; // dimmed after the command
  tap: string; // what a tap puts in chat
  needsArgs?: boolean; // left in chat to finish rather than sent
}

interface Group {
  title: string;
  rows: Row[];
}

const NOTICE_MS = 2600; // how long a greyed button's notice stays up

export class CommandsMenu {
  private readonly el = document.getElementById('commands')!;
  private open = false;
  private readonly noticeEl = document.createElement('div');
  private noticeTimer = 0;
  onCommand: ((text: string) => void) | null = null;
  onDraft: ((text: string) => void) | null = null; // opens chat with this typed
  onOpen: (() => void) | null = null;

  constructor() {
    const groups = buildGroups();
    // The body scrolls; the footer (guide note + close hint) stays put under it.
    this.el.innerHTML = IS_TOUCH ? touchHtml(groups) : keyboardHtml(groups);
    onTap(this.el, (e) => this.tap(e));
    // A tap hides the menu on its up, so the mouse events the browser follows it with would land on
    // the world beneath (taking focus from the chat a greyed button opens). Swipes still scroll.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') e.preventDefault();
    });
    // Outside the menu, so it stays up over the chat the tap opens.
    this.noticeEl.id = 'command-notice';
    document.body.append(this.noticeEl);
  }

  get isOpen(): boolean {
    return this.open;
  }

  // The card is a little page: scroll it from keys or the wheel (the wheel goes to the locked
  // canvas, not the card, so the Game forwards it); touch swipes scroll it natively.
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
    if (open) this.onOpen?.();
  }

  // Every tap closes the menu, so whatever a button did is in view. A button sends its command;
  // a greyed one opens chat with it typed and says to add the options there.
  private tap(e: PointerEvent): void {
    this.set(false);
    const button = e.target instanceof Element ? e.target.closest<HTMLElement>('.cmd-button') : null;
    const text = button?.dataset.tap;
    if (!button || !text) return;
    if (!('needsArgs' in button.dataset)) return this.onCommand?.(text);
    this.onDraft?.(text);
    this.noticeEl.textContent = 'add the options in chat, then send';
    this.noticeEl.classList.add('on');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.noticeEl.classList.remove('on'), NOTICE_MS);
  }
}

function buildGroups(): Group[] {
  // Skins: the default look last, so the ones you'd actually try come first.
  const skins = AVATAR_IDS.filter((id) => AVATARS[id].command && !AVATARS[id].hidden).sort(
    (a, b) => Number(a === 'standard') - Number(b === 'standard'),
  );
  const items = ITEM_IDS.filter((id) => !ITEMS[id].own);
  return [
    { title: 'equip item', rows: items.map((id) => command(id, ITEMS[id].blurb)) },
    {
      title: 'bot commands',
      rows: [
        ...BOT_IDS.map((id): Row => ({
          label: `/${BOTS[id].playerName}`,
          note: BOTS[id].blurb,
          args: nobreak(botArguments(BOTS[id].worker)),
          tap: `/${BOTS[id].playerName} `,
          needsArgs: true,
        })),
        command('kill-bots', 'every bot in the room drops dead'),
      ],
    },
    {
      title: 'wear skin',
      rows: [
        ...skins.map((id) => command(AVATARS[id].command ?? id, AVATARS[id].blurb)),
        { label: '/[color]', note: 'change your color', tap: '/', needsArgs: true },
      ],
    },
    {
      title: 'other',
      rows: [command('speedy', 'run faster for a bit'), ...GEAR_IDS.map((id) => command(id, GEAR[id].blurb))],
    },
  ];
}

function command(name: string, note: string): Row {
  const shortcuts = Object.entries(COMMAND_SHORTCUTS)
    .filter(([, c]) => c === name)
    .map(([shortcut]) => `/${shortcut}`);
  return { label: [`/${name}`, ...shortcuts].join(', '), note, tap: `/${name}` };
}

// Flags and their values unbreakable, so a line wraps only between "-t [seconds]" and the next,
// never inside "--skin" or "[name substrings]".
function nobreak(text: string): string {
  return text
    .replaceAll('-', '‑')
    .replace(/\[[^\]]*\]/g, (value) => value.replaceAll(' ', ' '))
    .replaceAll(' [', ' [');
}

function keyboardHtml(groups: Group[]): string {
  const sections = groups.map((g) => {
    const rows = g.rows.map((r) => {
      const args = r.args ? ` <span class="args">${r.args}</span>` : '';
      return `<li><span class="cmd">${r.label}${args}</span><span class="note">${r.note}</span></li>`;
    });
    return `<section><h2>${g.title}</h2><ul>${rows.join('')}</ul></section>`;
  });
  return `
    <div class="card">
      <div class="body">
        <h1>COMMANDS</h1>
        <p class="how">press Enter, type a command, Enter again</p>
        <div class="groups">${sections.join('')}</div>
      </div>
      <div class="footer">
        <div class="guide">MORE IN THE GUIDE: PRESS X FOR THE MENU</div>
        <div class="close-hint">PRESS <kbd>Q</kbd> TO CLOSE<span class="cursor">▮</span></div>
      </div>
    </div>`;
}

function touchHtml(groups: Group[]): string {
  const sections = groups.map((g) => {
    const buttons = g.rows.map((r) => {
      const label = r.label.split(', ')[0];
      const args = r.args ? `<span class="args" translate="no">${r.args}</span>` : '';
      return `<button class="cmd-button${r.needsArgs ? ' needs-args' : ''}" data-tap="${r.tap}"${r.needsArgs ? ' data-needs-args' : ''}>
        <span class="cmd" translate="no">${label}</span>${args}<span class="note">${r.note}</span></button>`;
    });
    return `<section><h2>${g.title}</h2><div class="buttons">${buttons.join('')}</div></section>`;
  });
  return `
    <div class="card touch">
      <div class="body">
        <h1>COMMANDS</h1>
        <p class="how">tap to use<span class="or">or type any of these in chat, options and all</span></p>
        <div class="groups">${sections.join('')}</div>
      </div>
      <div class="footer">
        <div class="guide">MORE IN THE GUIDE, IN THE MENU</div>
        <div class="close-hint">TAP TO EXIT<span class="cursor">▮</span></div>
      </div>
    </div>`;
}
