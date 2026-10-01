// The commands menu: every chat command, grouped, built from the item, gear and avatar registries so
// a new item or skin shows up here without anyone remembering to add it. Toggled with a key
// or the touch button, closed with Q/C or, on touch, a tap anywhere on it; purely informational.
// Blocks game input while open, like the cube card.
import {
  AVATARS,
  AVATAR_IDS,
  BOT_EXAMPLE,
  BOT_FLAG_IDS,
  BOT_FLAGS,
  BOTS,
  BOT_IDS,
  COMMAND_SHORTCUTS,
  GEAR,
  GEAR_IDS,
  ITEMS,
  ITEM_IDS,
  botArguments,
  type BotWorker,
} from '@world/shared';
import { IS_TOUCH, onTap } from '../input/touch';

interface Group {
  title: string;
  rows: [command: string, note: string, args?: string][]; // args: dimmed after the command
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
  const skins = AVATAR_IDS.filter((id) => AVATARS[id].command).sort(
    (a, b) => Number(a === 'standard') - Number(b === 'standard'),
  );
  return [
    { title: 'equip item', rows: ITEM_IDS.map((id) => [commandLabel(id), ITEMS[id].blurb]) },
    {
      title: 'bot commands',
      rows: [
        ...BOT_IDS.map((id): Group['rows'][number] => [
          `/${BOTS[id].playerName}`,
          BOTS[id].blurb,
          nobreak(botArguments(BOTS[id].worker)),
        ]),
        ['/kill-bots', 'every bot in the room drops dead'],
      ],
    },
    {
      // Each flag with the bots that take it, then one command putting them together.
      title: 'bot flags, in any order, each at most once',
      rows: [
        ...BOT_FLAG_IDS.map((id): Group['rows'][number] => {
          const f = BOT_FLAGS[id];
          const long = f.short === null ? '' : `, or ${nobreak(f.long)}`;
          return [nobreak(f.short ?? f.long), `${f.help} (${botsTaking(f.workers)}${long})`, nobreak(`[${f.value}]`)];
        }),
        [
          BOT_EXAMPLE.slice(0, BOT_EXAMPLE.indexOf(' ')),
          'for example',
          nobreak(BOT_EXAMPLE.slice(BOT_EXAMPLE.indexOf(' ') + 1)),
        ],
      ],
    },
    { title: 'wear skin', rows: skins.map((id) => [`/${AVATARS[id].command}`, AVATARS[id].blurb]) },
    {
      title: 'other',
      rows: [
        [commandLabel('speedy'), 'run faster for a bit'],
        ...GEAR_IDS.map((id): Group['rows'][number] => [commandLabel(id), GEAR[id].blurb]),
      ],
    },
  ];
}

// Flags and their values unbreakable, so a line wraps only between "-t [seconds]" and the next,
// never inside "--skin" or "[name substrings]".
function nobreak(text: string): string {
  return text
    .replaceAll('-', '\u2011')
    .replace(/\[[^\]]*\]/g, (value) => value.replaceAll(' ', '\u00a0'))
    .replaceAll(' [', '\u00a0[');
}

// "every bot", or the ones that take a flag by name.
function botsTaking(workers: BotWorker[]): string {
  const ids = BOT_IDS.filter((id) => workers.includes(BOTS[id].worker));
  return ids.length === BOT_IDS.length ? 'every bot' : ids.map((id) => `/${BOTS[id].playerName}`).join(', ');
}

function commandLabel(name: string): string {
  const shortcuts = Object.entries(COMMAND_SHORTCUTS)
    .filter(([, command]) => command === name)
    .map(([shortcut]) => `/${shortcut}`);
  return [`/${name}`, ...shortcuts].join(', ');
}

function groupHtml(g: Group): string {
  const rows = g.rows
    .map(([c, n, a]) => {
      const args = a ? ` <span class="args">${a}</span>` : '';
      return `<li><span class="cmd">${c}${args}</span><span class="note">${n}</span></li>`;
    })
    .join('');
  return `<section><h2>${g.title}</h2>${rows ? `<ul>${rows}</ul>` : `<p class="empty">${g.empty ?? ''}</p>`}</section>`;
}
