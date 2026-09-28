// The commands menu: every chat command, grouped, built from the item and avatar registries so
// a new item or skin shows up here without anyone remembering to add it. Toggled with a key
// or the touch button; purely informational.
import { AVATARS, AVATAR_IDS, ITEMS, ITEM_IDS, SPEEDY_SECONDS, itemHelp, itemStats } from '@world/shared';
import { IS_TOUCH } from '../input/touch';

interface Group {
  title: string;
  rows: [command: string, note: string][];
  foot?: string;
}

export class CommandsMenu {
  private readonly el = document.getElementById('commands')!;
  private open = false;
  everOpened = false;

  constructor() {
    const groups = buildGroups();
    const how = IS_TOUCH ? 'tap CHAT, type a command, send' : 'press Enter, type a command, Enter again';
    const close = IS_TOUCH ? 'tap CMDS to close' : 'C to close';
    this.el.innerHTML = `
      <div class="card">
        <h1>COMMANDS</h1>
        <p class="how">${how}</p>
        <div class="groups">${groups.map(groupHtml).join('')}</div>
        <p class="close">${close}</p>
      </div>`;
  }

  get isOpen(): boolean {
    return this.open;
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
  return [
    {
      title: 'equip item',
      rows: ITEM_IDS.map((id) => [`/${id}`, `${ITEMS[id].seconds}s · ${itemHelp(id)} · ${itemStats(id)}`]),
      foot: `${ITEM_IDS.map((id) => ITEMS[id].nameTag).join(', ')} in your name: yours for good`,
    },
    {
      title: 'wear skin',
      rows: AVATAR_IDS.map((id) => [`/${id}`, AVATARS[id].seconds ? `${AVATARS[id].seconds}s` : 'back to normal']),
      foot: `${AVATAR_IDS.map((id) => AVATARS[id].nameTag).filter(Boolean).join(', ')} in your name: yours for good`,
    },
    { title: 'boost', rows: [['/speedy', `${SPEEDY_SECONDS}s of 1.8x speed`]] },
    { title: 'call bot', rows: [], foot: 'nothing here yet' },
  ];
}

function groupHtml(g: Group): string {
  const rows = g.rows.map(([c, n]) => `<li><span class="cmd">${c}</span><span class="note">${n}</span></li>`).join('');
  return `<section><h2>${g.title}</h2><ul>${rows}</ul>${g.foot ? `<p class="foot">${g.foot}</p>` : ''}</section>`;
}
