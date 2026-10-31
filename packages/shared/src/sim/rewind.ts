// Lag compensation. A player sees everyone else a little in the past: remote players are drawn
// INTERP_DELAY_TICKS behind the newest snapshot, which was already half a round trip old when it
// arrived, and the shot then takes another half round trip to reach the server. So each input
// frame says which tick the player was looking at (`view`), and the server judges the shot
// against where the targets were at that tick instead of where they are now.
//
// PositionHistory is the server's short memory of where everyone was, one entry per snapshot: each
// player's eye point and, for a dragon, its spine (sim/dragon.ts).
import { MAX_REWIND_TICKS } from './constants';
import type { DragonState } from './dragon';
import type { Vec3 } from './types';

export interface Was {
  pos: Vec3;
  dragon: Pick<DragonState, 'spine'> | null;
}

interface Entry {
  tick: number;
  was: Map<string, Was>;
}

export class PositionHistory {
  private entries: Entry[] = [];

  // Remember where everyone was as sent in the snapshot for `tick`.
  record(tick: number, players: Iterable<Pick<Was, 'pos' | 'dragon'> & { id: string }>): void {
    const was = new Map<string, Was>();
    for (const p of players) was.set(p.id, { pos: { ...p.pos }, dragon: p.dragon && { spine: [...p.dragon.spine] } });
    this.entries.push({ tick, was });
    while (this.entries.length > MAX_REWIND_TICKS + 1) this.entries.shift();
  }

  // Where `id` was at `tick`, which may be fractional (the client draws between snapshots, so
  // it can be looking at tick 41.4): the eye point between the two records, and the spine of the
  // earlier one (it moves less than a body's width in a tick). Null when there is no record, e.g.
  // they just joined.
  at(id: string, tick: number): Was | null {
    let before: Entry | null = null;
    let after: Entry | null = null;
    for (const e of this.entries) {
      if (e.tick <= tick) before = e;
      if (e.tick >= tick) {
        after = e;
        break;
      }
    }
    const a = before?.was.get(id) ?? after?.was.get(id);
    const b = after?.was.get(id) ?? a;
    if (!a || !b) return null;
    const span = before && after ? after.tick - before.tick : 0;
    const t = span > 0 ? (tick - before!.tick) / span : 0;
    return {
      pos: {
        x: a.pos.x + (b.pos.x - a.pos.x) * t,
        y: a.pos.y + (b.pos.y - a.pos.y) * t,
        z: a.pos.z + (b.pos.z - a.pos.z) * t,
      },
      dragon: a.dragon,
    };
  }
}

// The tick a shot is judged at: what the shooter says they saw, but never in the future and
// never more than MAX_REWIND_TICKS back, so a slow or lying client gains at most that much.
export function rewindTick(view: number | undefined, now: number): number {
  if (view === undefined) return now;
  return Math.min(now, Math.max(now - MAX_REWIND_TICKS, view));
}
