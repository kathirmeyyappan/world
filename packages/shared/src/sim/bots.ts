// Bots a player can call from chat. Each runs as a Modal function (see modal-bots/) that joins
// the caller's room as a flagged player for a while. The registry key is what the Modal worker
// takes; the player name is what everyone sees. Adding a bot means a row here and a bot module
// under modal-bots/bots/.
import { isAvatarId, type AvatarId } from './avatars';
import type { Vec3 } from './types';

export type BotId = 'circle' | 'observer' | 'stalker';

export interface BotSpec {
  id: BotId;
  playerName: string; // in-game name, `<id>-bot`
  blurb: string; // one plain line for the commands menu
}

export const BOT_DEFAULT_SECONDS = 300; // a called bot's stay when the caller doesn't say
export const BOT_MAX_SECONDS = 3500; // the Modal worker's own cap (MAX_BOT_SECONDS)

export const BOTS: Record<BotId, BotSpec> = {
  circle: {
    id: 'circle',
    playerName: 'circle-bot',
    blurb: 'finds the nearest player and circles them',
  },
  observer: {
    id: 'observer',
    playerName: 'observer-bot',
    blurb: 'spawns in and does nothing',
  },
  stalker: {
    id: 'stalker',
    playerName: 'stalker-bot',
    blurb: 'stands still and turns to watch the nearest person',
  },
};

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

// What the room asks the host to start. `room` is the public room code the bot joins through the
// lobby, so it lands in the caller's session; `caller` is who asked ('room' for its starting bots).
export interface BotRequest extends BotPlacement {
  bot: BotId;
  room: string;
  seconds: number;
  caller: string;
}
