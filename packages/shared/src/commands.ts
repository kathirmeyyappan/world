// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
import { avatarForCommand, type AvatarId } from './sim/avatars';
import { BOT_DEFAULT_SECONDS, BOT_MAX_SECONDS, BOTS, botIdFor, type BotId } from './sim/bots';
import { isGearId, type GearId } from './sim/gear';
import { isItemId, type ItemId } from './sim/items';

export type Command =
  | { name: 'speedy' }
  | { name: 'equip'; item: ItemId }
  | { name: 'wear'; gear: GearId }
  | { name: 'avatar'; avatar: AvatarId }
  // seconds null: not a number. targets: the words after it, which only a combat bot takes.
  | { name: 'bot'; bot: BotId; seconds: number | null; targets: string[] }
  | { name: 'kill-bots' }
  | { name: 'unknown'; raw: string };

export const COMMAND_SHORTCUTS: Readonly<Partial<Record<string, ItemId | GearId | 'speedy'>>> = {
  g: 'gun',
  ft: 'flamethrower',
  j: 'jetpack',
  s: 'speedy',
};

export function parseCommand(text: string): Command | null {
  if (!text.startsWith('/')) return null;

  const [raw, ...args] = text.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const normalized = COMMAND_SHORTCUTS[name] ?? name;

  if (normalized === 'speedy') return { name: 'speedy' };
  if (isItemId(normalized)) return { name: 'equip', item: normalized };
  if (isGearId(normalized)) return { name: 'wear', gear: normalized };
  const avatar = avatarForCommand(normalized);
  if (avatar) return { name: 'avatar', avatar };
  if (normalized === 'kill-bots') return { name: 'kill-bots' };
  const bot = botIdFor(normalized);
  if (bot) return botCommand(bot, args);
  return { name: 'unknown', raw };
}

// "/circle-bot 60" or "/sniper-bot 60 kat bob": how long the bot stays (default when left out,
// capped, null when it isn't a number) and, for a combat bot, the names after it. A combat bot's
// first word counts as seconds only when it's a number, so "/sniper-bot kat" hunts kat for the
// default stay.
function botCommand(bot: BotId, args: string[]): Command {
  const combat = BOTS[bot].worker === 'combat';
  const [first, ...rest] = args;
  if (first === undefined || (combat && !Number.isFinite(Number(first))))
    return { name: 'bot', bot, seconds: BOT_DEFAULT_SECONDS, targets: combat ? args : [] };
  const n = Number(first);
  const seconds = Number.isFinite(n) && n > 0 ? Math.min(BOT_MAX_SECONDS, Math.round(n)) : null;
  return { name: 'bot', bot, seconds, targets: combat ? rest : [] };
}
