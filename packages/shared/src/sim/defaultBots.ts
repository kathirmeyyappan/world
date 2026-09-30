// Bots a room starts with. The first person to join a room brings these along (a room can't
// hold bots on its own, so nothing is spawned until someone is there to play with).
//
// Edit `defaultBotsFor` to change the line-up: it is a plain function of the room's public name,
// so profiles per room ("global" gets a crowd, "duel-*" gets none, ...) are one `if` away. A bot
// can be placed and dressed (BotPlacement); leave both out for a random spawn in its own look.

import { TUNG_TUNG_TOWER_FLOORS } from '../content/tower';
import { BOT_MAX_SECONDS, type BotId, type BotPlacement } from './bots';

export interface DefaultBot extends BotPlacement {
  bot: BotId;
  seconds: number; // how long each stays; they leave earlier if the room empties
}

// A room's own bots stay as long as a bot can; only people calling one get the shorter default.
const STAY = BOT_MAX_SECONDS;

// Two circle bots, wherever they land.
const TWO_CIRCLES: DefaultBot[] = [
  { bot: 'circle', seconds: STAY },
  { bot: 'circle', seconds: STAY },
];

// A stalker in the middle of each of the tower's lower three floors, watching whoever comes up.
const TOWER_STALKERS: DefaultBot[] = TUNG_TUNG_TOWER_FLOORS.slice(0, 3).map((spawn) => ({
  bot: 'stalker',
  seconds: STAY,
  spawn,
  avatar: 'sahur',
}));

export function defaultBotsFor(room: string): DefaultBot[] {
  if (room === 'global') return [...TWO_CIRCLES, ...TOWER_STALKERS];
  return [...TWO_CIRCLES, ...TOWER_STALKERS];
}
