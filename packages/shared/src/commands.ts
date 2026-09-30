// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
import { isWearableAvatar, type AvatarId } from './sim/avatars';
import { BOT_DEFAULT_SECONDS, BOT_MAX_SECONDS, botIdFor, type BotId } from './sim/bots';
import { isItemId, type ItemId } from './sim/items';

export type Command =
  | { name: 'speedy' }
  | { name: 'equip'; item: ItemId }
  | { name: 'avatar'; avatar: AvatarId }
  | { name: 'bot'; bot: BotId; seconds: number | null } // null: the seconds argument was not a number
  | { name: 'kill-bots' }
  | { name: 'unknown'; raw: string };

export const COMMAND_SHORTCUTS: Readonly<Partial<Record<string, ItemId | 'speedy'>>> = {
  g: 'gun',
  ft: 'flamethrower',
  s: 'speedy',
};

export function parseCommand(text: string): Command | null {
  if (!text.startsWith('/')) return null;

  const [raw, arg] = text.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const normalized = COMMAND_SHORTCUTS[name] ?? name;

  if (normalized === 'speedy') return { name: 'speedy' };
  if (isItemId(normalized)) return { name: 'equip', item: normalized };
  if (isWearableAvatar(normalized)) return { name: 'avatar', avatar: normalized };
  if (normalized === 'kill-bots') return { name: 'kill-bots' };
  const bot = botIdFor(normalized);
  if (bot) return { name: 'bot', bot, seconds: botSeconds(arg) };
  return { name: 'unknown', raw };
}

// "/circle-bot 60": seconds the bot lives, default when omitted, capped, null when not a number.
function botSeconds(arg: string | undefined): number | null {
  if (arg === undefined) return BOT_DEFAULT_SECONDS;
  const n = Number(arg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(BOT_MAX_SECONDS, Math.round(n));
}
