// Snapshot buffer for everything the server owns: remote players and cubes. Renders a few ticks
// behind the newest snapshot and lerps between the two that bracket that time.
import { INTERP_DELAY_TICKS, TICK_RATE, type CubeSnapshot, type PlayerState } from '@world/shared';

interface Snapshot {
  tick: number;
  players: Map<string, PlayerState>;
  cubes: Map<string, CubeSnapshot>;
}

export interface RemotePlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  reading: string | null;
}

const KEEP_TICKS = TICK_RATE * 2;

export class Interpolation {
  private buffer: Snapshot[] = [];
  private lastTick = 0;
  private lastAt = 0;

  push(tick: number, players: PlayerState[], cubes: CubeSnapshot[], now: number): void {
    if (this.buffer.length && tick <= this.buffer[this.buffer.length - 1].tick) return;
    this.buffer.push({ tick, players: new Map(players.map((p) => [p.id, p])), cubes: new Map(cubes.map((c) => [c.id, c])) });
    this.lastTick = tick;
    this.lastAt = now;
    while (this.buffer.length > 1 && this.buffer[0].tick < tick - KEEP_TICKS) this.buffer.shift();
  }

  sample(now: number, exclude: string): { players: RemotePlayer[]; cubes: CubeSnapshot[] } {
    if (this.buffer.length === 0) return { players: [], cubes: [] };
    const renderTick = this.lastTick + ((now - this.lastAt) / 1000) * TICK_RATE - INTERP_DELAY_TICKS;

    let older = this.buffer[0];
    let newer = this.buffer[0];
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i].tick <= renderTick) older = this.buffer[i];
      if (this.buffer[i].tick >= renderTick) {
        newer = this.buffer[i];
        break;
      }
      newer = this.buffer[i];
    }
    const span = newer.tick - older.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTick - older.tick) / span)) : 1;

    const players: RemotePlayer[] = [];
    for (const [id, b] of newer.players) {
      if (id === exclude) continue;
      const a = older.players.get(id) ?? b;
      players.push({
        id,
        name: b.name,
        color: b.color,
        x: lerp(a.pos.x, b.pos.x, t),
        y: lerp(a.pos.y, b.pos.y, t),
        z: lerp(a.pos.z, b.pos.z, t),
        yaw: lerpAngle(a.yaw, b.yaw, t),
        pitch: lerp(a.pitch, b.pitch, t),
        reading: b.reading,
      });
    }
    const cubes: CubeSnapshot[] = [];
    for (const [id, b] of newer.cubes) {
      const a = older.cubes.get(id) ?? b;
      cubes.push({
        id,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        z: lerp(a.z, b.z, t),
        rx: lerp(a.rx, b.rx, t),
        ry: lerpAngle(a.ry, b.ry, t),
      });
    }
    return { players, cubes };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
