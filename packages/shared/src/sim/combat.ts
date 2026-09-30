// Hitscan shooting, resolved on the server from the shooter's own position and look direction.
// A player is a vertical capsule from the feet, sized to their avatar (AVATARS[avatar].hitbox); the
// nearest one the ray passes through within range is the hit, and where on it the ray lands says
// whether it was a headshot. Structures stop shots: nothing behind a wall is hit. Damage numbers live in health.ts.
import { AVATARS, type AvatarId, type Hitbox } from './avatars';
import type { Structures } from './collision';
import { capsuleFeetY, isHeadshot } from './health';
import type { ItemSpec } from './items';
import type { Vec3 } from './types';
import { WORLD_STRUCTURES } from './world';

// Enough of a player to be shot at. PlayerState satisfies it; so does the client's remote view.
export interface Target {
  id: string;
  pos: Vec3;
  dead: boolean;
  avatar: AvatarId;
}

export interface Shooter {
  id: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
}

export interface Hit<T extends Target> {
  target: T;
  headshot: boolean;
}

// Unit vector the player is looking along. Matches the client camera: yaw 0 faces +z,
// positive pitch looks down.
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: Math.cos(yaw) * c };
}

// Everyone an item's shot reaches, per its fire shape: one player for hitscan, all of them
// for a cone.
export function resolveFire<T extends Target>(
  spec: Pick<ItemSpec, 'fire' | 'range'>,
  shooter: Shooter,
  players: Iterable<T>,
  structures: Structures = WORLD_STRUCTURES,
): Hit<T>[] {
  if (spec.fire.kind === 'cone') return findConeHits(shooter, players, spec.range, spec.fire.halfAngle, structures);
  const hit = findHit(shooter, players, spec.range, structures);
  return hit ? [hit] : [];
}

// Every live player with any part of their capsule inside the cone: within `range` of the eye
// and within `halfAngle` of the look direction, widened by the capsule radius, with a clear line
// from eye to eye. No headshots.
export function findConeHits<T extends Target>(
  shooter: Shooter,
  players: Iterable<T>,
  range: number,
  halfAngle: number,
  structures: Structures = WORLD_STRUCTURES,
): Hit<T>[] {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = shooter.pos;
  const hits: Hit<T>[] = [];
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    if (capsuleInCone(o, dir, p.pos, AVATARS[p.avatar].hitbox, range, halfAngle) && structures.clear(o, p.pos))
      hits.push({ target: p, headshot: false });
  }
  return hits;
}

function capsuleInCone(o: Vec3, d: Vec3, eye: Vec3, box: Hitbox, range: number, halfAngle: number): boolean {
  const a = capsuleFeetY(eye.y);
  const b = a + box.top;
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const cy = a + ((b - a) * i) / steps;
    const lx = eye.x - o.x;
    const ly = cy - o.y;
    const lz = eye.z - o.z;
    const dist = Math.hypot(lx, ly, lz);
    if (dist > range + box.radius) continue;
    if (dist <= box.radius) return true;
    const cos = (lx * d.x + ly * d.y + lz * d.z) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle <= halfAngle + Math.asin(Math.min(1, box.radius / dist))) return true;
  }
  return false;
}

export function findHit<T extends Target>(
  shooter: Shooter,
  players: Iterable<T>,
  range: number,
  structures: Structures = WORLD_STRUCTURES,
): Hit<T> | null {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = shooter.pos;
  let best: T | null = null;
  let bestT = Math.min(range, structures.raycast(o, dir, range)); // the shot stops at the first wall
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    const t = rayCapsule(o, dir, p.pos, AVATARS[p.avatar].hitbox, bestT);
    if (t !== null && t < bestT) {
      bestT = t;
      best = p;
    }
  }
  if (!best) return null;
  return { target: best, headshot: isHeadshot(o.y + dir.y * bestT, best.pos.y, AVATARS[best.avatar].hitbox) };
}

// Distance along the ray to the hitbox of a player whose eyes are at `eye`, or null. Checks the ray
// against spheres of the hitbox's radius strung along its axis, one every half radius or closer.
function rayCapsule(o: Vec3, d: Vec3, eye: Vec3, box: Hitbox, maxT: number): number | null {
  const a = { x: eye.x, y: capsuleFeetY(eye.y), z: eye.z };
  const b = { x: eye.x, y: a.y + box.top, z: eye.z };
  let bestT: number | null = null;
  const steps = Math.max(8, Math.ceil(box.top / (box.radius / 2)));
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const c = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s };
    const t = raySphere(o, d, c, box.radius);
    if (t !== null && t <= maxT && (bestT === null || t < bestT)) bestT = t;
  }
  return bestT;
}

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const lx = c.x - o.x;
  const ly = c.y - o.y;
  const lz = c.z - o.z;
  const tca = lx * d.x + ly * d.y + lz * d.z;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return null;
  const thc = Math.sqrt(r * r - d2);
  return Math.max(0, tca - thc);
}
