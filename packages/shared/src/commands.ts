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
  | { name: 'bot'; bot: BotId; call: BotCallArgs | null } // null: the flags didn't parse
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

// What a bot command asked for: how long the bot stays, what it's called (null: its own name),
// and, for a combat bot, the name substrings it goes after.
export interface BotCallArgs {
  seconds: number;
  botName: string | null;
  targets: string[];
}

// "/sniper-bot -t 60 -n hunter --targets kat bob": flags in any order, each at most once.
// -t is the seconds (default when left out, capped), -n the bot's name, and --targets, for a
// combat bot only, every word up to the next flag. Anything else (a bare word, an unknown or
// repeated flag, a flag with no value) makes it null, and the room answers with the usage line.
function botCommand(bot: BotId, args: string[]): Command {
  const bad: Command = { name: 'bot', bot, call: null };
  const call: BotCallArgs = { seconds: BOT_DEFAULT_SECONDS, botName: null, targets: [] };
  const given = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (given.has(flag)) return bad;
    given.add(flag);
    const value = (): string | null => (i + 1 < args.length && !args[i + 1].startsWith('-') ? args[++i] : null);
    if (flag === '-t') {
      const n = Number(value());
      if (!Number.isFinite(n) || n <= 0) return bad;
      call.seconds = Math.min(BOT_MAX_SECONDS, Math.round(n));
    } else if (flag === '-n') {
      call.botName = value();
      if (call.botName === null) return bad;
    } else if (flag === '--targets' && BOTS[bot].worker === 'combat') {
      for (let word = value(); word !== null; word = value()) call.targets.push(word);
      if (call.targets.length === 0) return bad;
    } else return bad;
  }
  return { name: 'bot', bot, call };
}
