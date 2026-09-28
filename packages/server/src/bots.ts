// Starts bots on Modal for a room. The only file that talks to Modal: it spawns the bots app's
// `run_bot` function with the caller's room code and the seconds asked for, and returns as
// soon as the call is queued; the bot then joins through the lobby like any player.
import { ModalClient, type Function_ } from 'modal';
import type { BotSpawner } from '@world/shared';

const BOTS_APP = process.env.BOTS_APP ?? 'kathir-world-bots';
const BOTS_FUNCTION = 'run_bot';

// A spawner when this host has Modal credentials (MODAL_TOKEN_ID / MODAL_TOKEN_SECRET), else
// null and rooms tell players bots can't be called here.
export function createBotSpawner(log: (msg: string) => void): BotSpawner | null {
  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) return null;
  const client = new ModalClient();
  let runBot: Promise<Function_> | null = null;
  return async (req) => {
    runBot ??= client.functions.fromName(BOTS_APP, BOTS_FUNCTION);
    const call = await (await runBot).spawn([], { bot: req.bot, room: req.room, seconds: req.seconds });
    log(`${req.caller} called ${req.bot} for ${req.seconds}s in ${req.room}: ${call.functionCallId}`);
  };
}
