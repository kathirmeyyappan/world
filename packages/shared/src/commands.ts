// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
import { avatarForCommand, type AvatarId } from './sim/avatars';
import {
  BOT_DEFAULT_SECONDS,
  BOT_FLAGS,
  BOT_MAX_SECONDS,
  BOTS,
  botFlagFor,
  botIdFor,
  type BotFlag,
  type BotId,
} from './sim/bots';
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

// What a bot command asked for: how long the bot stays, what it's called (null: its own name), how
// it looks (null: its own look), and, for a combat bot, the name substrings it goes after.
export interface BotCallArgs {
  seconds: number;
  botName: string | null;
  avatar: AvatarId | null;
  targets: string[];
}

// "/sniper-bot -t 60 -n hunter -s tung --targets kat bob": the flags in BOT_FLAGS (short or long
// form), in any order, each at most once, and only those the bot's worker takes. Anything else (a
// bare word, an unknown or repeated flag, a flag with no value or a bad one) makes it null, and the
// room answers with the usage line.
function botCommand(bot: BotId, args: string[]): Command {
  const bad: Command = { name: 'bot', bot, call: null };
  const call: BotCallArgs = { seconds: BOT_DEFAULT_SECONDS, botName: null, avatar: null, targets: [] };
  const given = new Set<BotFlag>();
  for (let i = 0; i < args.length; i++) {
    const flag = botFlagFor(args[i]);
    if (flag === null || given.has(flag) || !BOT_FLAGS[flag].workers.includes(BOTS[bot].worker)) return bad;
    given.add(flag);
    const value = (): string | null => (i + 1 < args.length && !args[i + 1].startsWith('-') ? args[++i] : null);
    switch (flag) {
      case 'time': {
        const n = Number(value());
        if (!Number.isFinite(n) || n <= 0) return bad;
        call.seconds = Math.min(BOT_MAX_SECONDS, Math.round(n));
        break;
      }
      case 'name':
        call.botName = value();
        if (call.botName === null) return bad;
        break;
      case 'skin':
        call.avatar = avatarForCommand(value() ?? '');
        if (call.avatar === null) return bad;
        break;
      case 'targets':
        for (let word = value(); word !== null; word = value()) call.targets.push(word);
        if (call.targets.length === 0) return bad;
        break;
    }
  }
  return { name: 'bot', bot, call };
}
