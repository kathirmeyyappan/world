// Bots a room starts with. The first person to join a room brings these along (a room can't
// hold bots on its own, so nothing is spawned until someone is there to play with).
//
// Edit `defaultBotsFor` to change the line-up: it is a plain function of the room's public name,
// so profiles per room ("global" gets a crowd, "duel-*" gets none, ...) are one `if` away.

import { BOT_MAX_SECONDS, type BotId } from './bots';

export interface DefaultBot {
  bot: BotId;
  seconds: number; // how long each stays; they leave earlier if the room empties
}

// Two circle bots that stay as long as a bot can. Named so profiles below can reuse it.
const TWO_CIRCLES: DefaultBot[] = [
  { bot: 'circle', seconds: BOT_MAX_SECONDS },
  { bot: 'circle', seconds: BOT_MAX_SECONDS },
];

export function defaultBotsFor(room: string): DefaultBot[] {
  if (room === 'global') return TWO_CIRCLES;
  return TWO_CIRCLES;
}
