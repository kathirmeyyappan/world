// Starts bots for a room by asking the sidecar next door. On Modal the Python process that
// supervises this server listens on localhost and spawns the bots app's `run_bot` with the
// container's own credentials (see infra/bot_sidecar.py); Node never holds a Modal token.
// Returns once the sidecar has queued the call; the bot then joins through the lobby like any
// player. The request body is the shared BotRequest, as JSON.
import type { BotSpawner } from '@world/shared';

// A spawner when a sidecar is configured (BOT_SPAWNER_URL), else null and rooms tell players
// bots can't be called here.
export function createBotSpawner(log: (msg: string) => void): BotSpawner | null {
  const url = process.env.BOT_SPAWNER_URL;
  if (!url) return null;
  return async (req) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`bot sidecar answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    log(`${req.caller} called ${req.bot} for ${req.seconds}s in ${req.room}: ${await res.text()}`);
  };
}
