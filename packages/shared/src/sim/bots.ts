// Bots a player can call from chat. Each runs as a Modal function (see modal-bots/) that joins
// the caller's room as a flagged player for a while. The registry key is what the Modal worker
// takes; the player name is what everyone sees. Adding a bot means a row here and a bot module
// under modal-bots/bots/.
export type BotId = 'circle' | 'observer';

export interface BotSpec {
  id: BotId;
  playerName: string; // in-game name, `<id>-bot`
  blurb: string; // one plain line for the commands menu
}

export const BOTS: Record<BotId, BotSpec> = {
  circle: { id: 'circle', playerName: 'circle-bot', blurb: 'finds the nearest player and circles them' },
  observer: { id: 'observer', playerName: 'observer-bot', blurb: 'spawns in and does nothing' },
};

export const BOT_IDS = Object.keys(BOTS) as BotId[];
export const BOT_DEFAULT_SECONDS = 300;
export const BOT_MAX_SECONDS = 3500; // the Modal worker's own cap (MAX_BOT_SECONDS)

export function isBotId(v: unknown): v is BotId {
  return typeof v === 'string' && v in BOTS;
}

// "/circle-bot" and "/circle" both mean the circle bot.
export function botIdFor(word: string): BotId | null {
  const id = word.endsWith('-bot') ? word.slice(0, -4) : word;
  return isBotId(id) ? id : null;
}

// What a chat command asks the room to start. `room` is the public room code the bot joins
// through the lobby, so it lands in the caller's session.
export interface BotRequest {
  bot: BotId;
  room: string;
  seconds: number;
  caller: string;
}
