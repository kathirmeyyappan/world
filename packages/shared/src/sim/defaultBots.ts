// Bots a room starts with. The first person to join a room brings these along (a room can't
// hold bots on its own, so nothing is spawned until someone is there to play with).
//
// Edit `defaultBotsFor` to change the line-up: it is a plain function of the room's public name,
// so profiles per room ("global" gets a crowd, "duel-*" gets none, ...) are one `if` away. A bot
// can be placed and dressed (BotPlacement); leave both out for a random spawn in its own look.

import { TUNG_TUNG_TOWER_FLOORS } from '../content/tower';
import type { AvatarId } from './avatars';
import { BOT_MAX_SECONDS, type BotId, type BotPlacement } from './bots';
import type { Rng } from './rng';

export interface DefaultBot extends BotPlacement {
  bot: BotId;
  seconds: number; // how long each stays; they leave earlier if the room empties
  targets?: string[]; // a combat bot's quarry (BotRequest); none means every person
}

// A room's own bots stay as long as a bot can; only people calling one get the shorter default.
const STAY = BOT_MAX_SECONDS;

// The looks a room's circle bots wear, drawn at random, no two alike.
export const CIRCLE_LOOKS: readonly AvatarId[] = ['sulley', 'mike', 'spongebob', 'patrick', 'krabs', 'elizabeth'];
const CIRCLES = 2;

// The circle bots, wherever they land, each in a look of its own.
function circles(rng: Rng): DefaultBot[] {
  const looks = [...CIRCLE_LOOKS];
  return Array.from({ length: CIRCLES }, () => {
    const [avatar] = looks.splice(Math.floor(rng() * looks.length), 1);
    return { bot: 'circle', seconds: STAY, avatar };
  });
}

// A stalker in the middle of each of the tower's lower three floors, watching whoever comes up.
const TOWER_STALKERS: DefaultBot[] = TUNG_TUNG_TOWER_FLOORS.slice(0, 3).map((spawn) => ({
  bot: 'stalker',
  seconds: STAY,
  spawn,
  avatar: 'sahur',
}));

export function defaultBotsFor(room: string, rng: Rng = Math.random): DefaultBot[] {
  if (room === 'global') return [...circles(rng), ...TOWER_STALKERS];
  return [...circles(rng), ...TOWER_STALKERS];
}
