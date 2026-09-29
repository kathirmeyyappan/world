// Lag compensation. A player sees everyone else a little in the past: remote players are drawn
// INTERP_DELAY_TICKS behind the newest snapshot, which was already half a round trip old when it
// arrived, and the shot then takes another half round trip to reach the server. So each input
// frame says which tick the player was looking at (`view`), and the server judges the shot
// against where the targets were at that tick instead of where they are now.
//
// PositionHistory is the server's short memory of where everyone was, one entry per snapshot.
import { MAX_REWIND_TICKS } from './constants';
import type { Vec3 } from './types';

interface Entry {
  tick: number;
  pos: Map<string, Vec3>;
}

export class PositionHistory {
  private entries: Entry[] = [];

  // Remember everyone's position as sent in the snapshot for `tick`.
  record(tick: number, players: Iterable<{ id: string; pos: Vec3 }>): void {
    const pos = new Map<string, Vec3>();
    for (const p of players) pos.set(p.id, { ...p.pos });
    this.entries.push({ tick, pos });
    while (this.entries.length > MAX_REWIND_TICKS + 1) this.entries.shift();
  }

  // Where `id` was at `tick`, which may be fractional (the client draws between snapshots, so
  // it can be looking at tick 41.4). Null when there is no record, e.g. they just joined.
  at(id: string, tick: number): Vec3 | null {
    let before: Entry | null = null;
    let after: Entry | null = null;
    for (const e of this.entries) {
      if (e.tick <= tick) before = e;
      if (e.tick >= tick) {
        after = e;
        break;
      }
    }
    const a = before?.pos.get(id) ?? after?.pos.get(id);
    const b = after?.pos.get(id) ?? a;
    if (!a || !b) return null;
    const span = before && after ? after.tick - before.tick : 0;
    const t = span > 0 ? (tick - before!.tick) / span : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }
}

// The tick a shot is judged at: what the shooter says they saw, but never in the future and
// never more than MAX_REWIND_TICKS back, so a slow or lying client gains at most that much.
export function rewindTick(view: number | undefined, now: number): number {
  if (view === undefined) return now;
  return Math.min(now, Math.max(now - MAX_REWIND_TICKS, view));
}
