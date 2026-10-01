// Snapshot buffer for everything the server owns: remote players, cubes and pickups. Renders a few ticks
// behind the newest snapshot and lerps between the two that bracket that time.
import {
  INTERP_DELAY_TICKS,
  TICK_RATE,
  type CubeSnapshot,
  type PickupSnapshot,
  type PlayerState,
  type ItemId,
  type GearId,
  type AvatarId,
} from '@world/shared';

interface Snapshot {
  tick: number;
  players: Map<string, PlayerState>;
  cubes: Map<string, CubeSnapshot>;
  pickups: Map<string, PickupSnapshot>;
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
  item: ItemId | null;
  firing: boolean;
  gear: GearId | null;
  thrusting: boolean;
  dead: boolean;
  avatar: AvatarId;
  // Standing on something (a floor, a stair, a deck): the sim zeroes vy whenever a player is on the
  // ground, so this is the server's own answer rather than a guess from the drawn height.
  grounded: boolean;
}

const KEEP_TICKS = TICK_RATE * 2;

export class Interpolation {
  private buffer: Snapshot[] = [];
  private lastTick = 0;
  private lastAt = 0;
  // The server tick remote players were last drawn at; sent with input so shots are judged there.
  viewTick: number | undefined;

  // A welcome or snapshot message's world.
  push(
    {
      tick,
      players,
      cubes,
      pickups,
    }: { tick: number; players: PlayerState[]; cubes: CubeSnapshot[]; pickups: PickupSnapshot[] },
    now: number,
  ): void {
    if (this.buffer.length && tick <= this.buffer[this.buffer.length - 1].tick) return;
    this.buffer.push({
      tick,
      players: new Map(players.map((p) => [p.id, p])),
      cubes: new Map(cubes.map((c) => [c.id, c])),
      pickups: new Map(pickups.map((p) => [p.id, p])),
    });
    this.lastTick = tick;
    this.lastAt = now;
    while (this.buffer.length > 1 && this.buffer[0].tick < tick - KEEP_TICKS) this.buffer.shift();
  }

  sample(now: number, exclude: string): { players: RemotePlayer[]; cubes: CubeSnapshot[]; pickups: PickupSnapshot[] } {
    if (this.buffer.length === 0) return { players: [], cubes: [], pickups: [] };
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
    this.viewTick = older.tick + span * t;

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
        item: b.item?.id ?? null,
        firing: b.firing,
        gear: b.gear?.id ?? null,
        thrusting: b.thrusting,
        dead: b.dead,
        avatar: b.avatar,
        grounded: b.vy === 0,
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
    const pickups: PickupSnapshot[] = [];
    for (const [id, b] of newer.pickups) {
      const a = older.pickups.get(id) ?? b;
      pickups.push({
        ...b,
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        z: lerp(a.z, b.z, t),
        ry: lerpAngle(a.ry, b.ry, t),
      });
    }
    return { players, cubes, pickups };
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
