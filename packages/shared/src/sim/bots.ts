// Bots a player can call from chat. Each runs on one of the bots app's Modal workers (see
// modal-bots/) and joins the caller's room as a flagged player for a while. The registry key is
// what the worker takes; the player name is what everyone sees. A row here needs a bot module
// under modal-bots/bots/, registered with its worker; a module without a row (the observer) is
// only started by hand with `modal run`.
import { isAvatarId, type AvatarId } from './avatars';
import type { Vec3 } from './types';

export type BotId = 'circle' | 'stalker' | 'sniper';

// The bots app's workers, each with its own arguments. A dumb bot takes only how long to stay; a
// combat bot reads the world map (line of sight, a way round) and takes the names it hunts.
export type BotWorker = 'dumb' | 'combat';

export interface BotSpec {
  id: BotId;
  playerName: string; // in-game name, `<id>-bot`
  worker: BotWorker;
  blurb: string; // one plain line for the commands menu
}

export const BOT_DEFAULT_SECONDS = 300; // a called bot's stay when the caller doesn't say
export const BOT_MAX_SECONDS = 3500; // the Modal workers' own cap (MAX_BOT_SECONDS)

export const BOTS: Record<BotId, BotSpec> = {
  circle: {
    id: 'circle',
    playerName: 'circle-bot',
    worker: 'dumb',
    blurb: 'finds the nearest player and circles them',
  },
  stalker: {
    id: 'stalker',
    playerName: 'stalker-bot',
    worker: 'dumb',
    blurb: 'stands still and turns to watch the nearest person',
  },
  sniper: {
    id: 'sniper',
    playerName: 'sniper-bot',
    worker: 'combat',
    blurb: 'climbs to a lookout and snipes every person',
  },
};

// What follows a bot's command for each worker, for usage lines and the commands menu.
export const BOT_ARGUMENTS: Record<BotWorker, string> = {
  dumb: '[-t seconds] [-n name]',
  combat: '[-t seconds] [-n name] [--targets name substrings]',
};

// Each flag a bot command takes (commands.ts parses them), explained for the commands menu, and
// the bots it works for.
export const BOT_FLAGS: { flag: string; help: string; workers: BotWorker[] }[] = [
  {
    flag: '-t seconds',
    help: `how long it stays, in seconds: ${BOT_DEFAULT_SECONDS} unless you say, up to ${BOT_MAX_SECONDS}`,
    workers: ['dumb', 'combat'],
  },
  { flag: '-n name', help: 'what it plays as, instead of its own name', workers: ['dumb', 'combat'] },
  {
    flag: '--targets names…',
    help: 'who it goes after: words up to the next flag, each any part of a name, any case; every person if left out',
    workers: ['combat'],
  },
];
export const BOT_EXAMPLE = '/sniper-bot -t 120 -n hunter --targets kat bob';

export const BOT_IDS = Object.keys(BOTS) as BotId[];

export function isBotId(v: unknown): v is BotId {
  return typeof v === 'string' && v in BOTS;
}

// "/circle-bot" and "/circle" both mean the circle bot.
export function botIdFor(word: string): BotId | null {
  const id = word.endsWith('-bot') ? word.slice(0, -4) : word;
  return isBotId(id) ? id : null;
}

// Where a bot stands when it joins and how it looks, both optional. The bot sends these when it
// joins and the room honours them for bots only: `spawn` is a feet position, clamped into the world
// and dropped onto whatever surface is under it; `avatar` is fixed for the bot's whole run.
export interface BotPlacement {
  spawn?: Vec3;
  avatar?: AvatarId;
}

// A placement from a bot's join URL: `x`, `y` (feet) and `z` together, and `avatar`. Anything
// missing or malformed is left out, so the bot spawns at random or in its own look.
export function placementFromQuery(get: (key: string) => string | null): BotPlacement {
  const placement: BotPlacement = {};
  const [x, y, z] = ['x', 'y', 'z'].map((k) => Number(get(k) ?? NaN));
  if ([x, y, z].every(Number.isFinite)) placement.spawn = { x, y, z };
  const avatar = get('avatar');
  if (isAvatarId(avatar)) placement.avatar = avatar;
  return placement;
}

// What the room asks the host to start, on the bot's worker. `room` is the public room code the
// bot joins through the lobby, so it lands in the caller's session; `caller` is who asked ('room'
// for its starting bots); `name`, when given, is what the bot plays as instead of its playerName.
// A combat bot's `targets` are parts of names, any case, that it goes after; none means every
// person (bots only when named), and never the bot itself.
interface BotCall extends BotPlacement {
  bot: BotId;
  room: string;
  seconds: number;
  caller: string;
  name?: string;
}

export type BotRequest = (BotCall & { worker: 'dumb' }) | (BotCall & { worker: 'combat'; targets: string[] });

export function botRequest(call: BotCall, targets: readonly string[] = []): BotRequest {
  return BOTS[call.bot].worker === 'combat'
    ? { ...call, worker: 'combat', targets: [...targets] }
    : { ...call, worker: 'dumb' };
}
