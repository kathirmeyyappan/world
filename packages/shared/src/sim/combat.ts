// Hitscan shooting, resolved on the server from the shooter's own position and look direction.
// A player is a vertical capsule from feet to just above the eyes; the nearest one the ray
// passes through within range is the hit, and where on it the ray lands says whether it was
// a headshot. Damage numbers live in health.ts.
import { HIT_RADIUS } from './constants';
import { CAPSULE_TOP, capsuleFeetY, isHeadshot } from './health';
import type { ItemSpec } from './items';
import type { Vec3 } from './types';

// Enough of a player to be shot at. PlayerState satisfies it; so does the client's remote view.
export interface Target {
  id: string;
  pos: Vec3;
  dead: boolean;
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
): Hit<T>[] {
  if (spec.fire.kind === 'cone') return findConeHits(shooter, players, spec.range, spec.fire.halfAngle);
  const hit = findHit(shooter, players, spec.range);
  return hit ? [hit] : [];
}

// Every live player with any part of their capsule inside the cone: within `range` of the eye
// and within `halfAngle` of the look direction, widened by the capsule radius. No headshots.
export function findConeHits<T extends Target>(
  shooter: Shooter,
  players: Iterable<T>,
  range: number,
  halfAngle: number,
): Hit<T>[] {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = shooter.pos;
  const hits: Hit<T>[] = [];
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    if (capsuleInCone(o, dir, p.pos, range, halfAngle)) hits.push({ target: p, headshot: false });
  }
  return hits;
}

function capsuleInCone(o: Vec3, d: Vec3, eye: Vec3, range: number, halfAngle: number): boolean {
  const a = capsuleFeetY(eye.y);
  const b = eye.y + CAPSULE_TOP;
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const cy = a + ((b - a) * i) / steps;
    const lx = eye.x - o.x;
    const ly = cy - o.y;
    const lz = eye.z - o.z;
    const dist = Math.hypot(lx, ly, lz);
    if (dist > range + HIT_RADIUS) continue;
    if (dist <= HIT_RADIUS) return true;
    const cos = (lx * d.x + ly * d.y + lz * d.z) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle <= halfAngle + Math.asin(Math.min(1, HIT_RADIUS / dist))) return true;
  }
  return false;
}

export function findHit<T extends Target>(shooter: Shooter, players: Iterable<T>, range: number): Hit<T> | null {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = shooter.pos;
  let best: T | null = null;
  let bestT = range;
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    const t = rayCapsule(o, dir, p.pos, bestT);
    if (t !== null && t < bestT) {
      bestT = t;
      best = p;
    }
  }
  if (!best) return null;
  return { target: best, headshot: isHeadshot(o.y + dir.y * bestT, best.pos.y) };
}

// Distance along the ray to a capsule around `eye` (feet at the bottom, top a bit above the
// eye), or null. Checks the ray against the capsule's axis segment plus HIT_RADIUS.
function rayCapsule(o: Vec3, d: Vec3, eye: Vec3, maxT: number): number | null {
  const a = { x: eye.x, y: capsuleFeetY(eye.y), z: eye.z };
  const b = { x: eye.x, y: eye.y + CAPSULE_TOP, z: eye.z };
  // Coarse: closest approach between the ray and the axis segment, then check the radius.
  let bestT: number | null = null;
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const c = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s };
    const t = raySphere(o, d, c, HIT_RADIUS);
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
