// Every chat command, grouped, built from the item, gear, bot and avatar registries so a new one
// shows up without anyone remembering to add it: what the commands card (CommandsMenu.ts) offers as
// buttons and what the chat (Hud.ts) completes a slash into.
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

export interface Row {
  label: string; // the command and its shortcuts, as shown
  note: string;
  args?: string; // dimmed after the command
  tap: string; // what choosing it puts in chat
  needsArgs?: boolean; // left in chat to finish rather than sent
}

export interface Group {
  title: string;
  rows: Row[];
}

const COMPLETIONS = 8; // offered at most: typing more narrows them

export function commandGroups(): Group[] {
  // Skins: the default look last, so the ones you'd actually try come first.
  const skins = AVATAR_IDS.filter((id) => AVATARS[id].command && !AVATARS[id].hidden).sort(
    (a, b) => Number(a === 'standard') - Number(b === 'standard'),
  );
  const items = ITEM_IDS.filter((id) => !ITEMS[id].own);
  return [
    {
      title: 'equip item',
      rows: [...items.map((id) => command(id, ITEMS[id].blurb)), ...GEAR_IDS.map((id) => command(id, GEAR[id].blurb))],
    },
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
      rows: [command('speedy', 'run faster for a bit')],
    },
  ];
}

// The commands `text` could be the start of, where it's a command being typed (from the slash, no
// arguments yet), best first: the ones named so, then the ones with a shortcut named so.
export function completionsOf(rows: Row[], text: string): Row[] {
  const typed = text.trim().toLowerCase();
  if (!typed.startsWith('/') || text.includes(' ')) return [];
  const names = (row: Row) => row.label.split(', ');
  const byName = rows.filter((row) => row.tap !== '/' && names(row)[0].startsWith(typed));
  const byShortcut = rows.filter(
    (row) => row.tap !== '/' && !byName.includes(row) && names(row).some((name) => name.startsWith(typed)),
  );
  return [...byName, ...byShortcut].slice(0, COMPLETIONS);
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
    .replace(/\[[^\]]*\]/g, (value) => value.replaceAll(' ', ' '))
    .replaceAll(' [', ' [');
}
