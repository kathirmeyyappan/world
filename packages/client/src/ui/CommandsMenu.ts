// The commands menu: every chat command, grouped, built from the item and avatar registries so
// a new item or skin shows up here without anyone remembering to add it. Toggled with a key
// or the touch button, closed with Q/C or, on touch, a tap anywhere on it; purely informational.
// Blocks game input while open, like the cube card.
import { AVATARS, AVATAR_IDS, BOTS, BOT_DEFAULT_SECONDS, BOT_IDS, COMMAND_SHORTCUTS, ITEMS, ITEM_IDS } from '@world/shared';
import { IS_TOUCH, onTap } from '../input/touch';

interface Group {
  title: string;
  rows: [command: string, note: string][];
  empty?: string;
}

export class CommandsMenu {
  private readonly el = document.getElementById('commands')!;
  private open = false;
  everOpened = false;

  constructor() {
    const groups = buildGroups();
    const how = IS_TOUCH ? 'tap CHAT, type a command, send' : 'press Enter, type a command, Enter again';
    const close = IS_TOUCH ? 'TAP TO CLOSE' : 'PRESS <kbd>Q</kbd> TO CLOSE';
    // The body scrolls; the footer (guide note + close hint) stays put under it.
    this.el.innerHTML = `
      <div class="card">
        <div class="body">
          <h1>COMMANDS</h1>
          <p class="how">${how}</p>
          <div class="groups">${groups.map(groupHtml).join('')}</div>
        </div>
        <div class="footer">
          <div class="guide">SEE GUIDE IN HOME MENU FOR MORE INFO</div>
          <div class="close-hint">${close}<span class="cursor">▮</span></div>
        </div>
      </div>`;
    onTap(this.el, () => this.set(false));
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
    if (open) this.everOpened = true;
    this.el.classList.toggle('hidden', !open);
  }
}

function buildGroups(): Group[] {
  // Skins: the default look last, so the ones you'd actually try come first.
  const skins = [...AVATAR_IDS].sort((a, b) => Number(a === 'standard') - Number(b === 'standard'));
  return [
    { title: 'equip item', rows: ITEM_IDS.map((id) => [commandLabel(id), ITEMS[id].blurb]) },
    {
      title: 'call bot',
      rows: BOT_IDS.map((id) => [`/${BOTS[id].playerName} [seconds]`, `${BOTS[id].blurb} · ${BOT_DEFAULT_SECONDS}s unless you say`]),
    },
    { title: 'wear skin', rows: skins.map((id) => [`/${id}`, AVATARS[id].blurb]) },
    { title: 'other', rows: [[commandLabel('speedy'), 'run faster for a bit']] },
  ];
}

function commandLabel(name: string): string {
  const shortcuts = Object.entries(COMMAND_SHORTCUTS)
    .filter(([, command]) => command === name)
    .map(([shortcut]) => `/${shortcut}`);
  return [`/${name}`, ...shortcuts].join(', ');
}

function groupHtml(g: Group): string {
  const rows = g.rows.map(([c, n]) => `<li><span class="cmd">${c}</span><span class="note">${n}</span></li>`).join('');
  return `<section><h2>${g.title}</h2>${rows ? `<ul>${rows}</ul>` : `<p class="empty">${g.empty ?? ''}</p>`}</section>`;
}
