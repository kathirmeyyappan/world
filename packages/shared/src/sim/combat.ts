// Shooting, resolved on the server from the shooter's avatar's eyes (eyeOf) along their look. A
// shot has to land in the target's class's hit shape (classes.ts): a walker's upright capsule, sized
// to their avatar, or a dragon's head and body spheres. Hitscan takes the nearest one the ray passes
// through within range, and where on it the ray lands says whether it was a headshot; a cone takes
// everyone with any of it inside. Structures stop shots: nothing behind a wall is hit. Damage
// numbers live in health.ts.
import { eyeOf, type AvatarId, type Hitbox } from './avatars';
import { classOf, type HitShape, type Sphere } from './classes';
import type { Structures } from './collision';
import type { DragonState } from './dragon';
import { capsuleFeetY, isHeadshot } from './health';
import type { ItemSpec } from './items';
import { lookDirection } from './look';
import type { Vec3 } from './types';
import { WORLD_STRUCTURES } from './world';

export { lookDirection };

// Enough of a player to be shot at. PlayerState satisfies it; so does the client's remote view.
export interface Target {
  id: string;
  pos: Vec3;
  dead: boolean;
  avatar: AvatarId;
  dragon: Pick<DragonState, 'spine'> | null;
}

export interface Shooter {
  id: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  avatar: AvatarId;
}

export interface Hit<T extends Target> {
  target: T;
  headshot: boolean;
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

// Every live player with any part of their shape inside the cone: within `range` of the eye and
// within `halfAngle` of the look direction, widened by the part's radius, with a clear line from
// the eye to it. No headshots.
export function findConeHits<T extends Target>(
  shooter: Shooter,
  players: Iterable<T>,
  range: number,
  halfAngle: number,
  structures: Structures = WORLD_STRUCTURES,
): Hit<T>[] {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = eyeOf(shooter);
  const hits: Hit<T>[] = [];
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    if (inCone(o, dir, classOf(p.avatar).hitShape(p), range, halfAngle, structures))
      hits.push({ target: p, headshot: false });
  }
  return hits;
}

function inCone(o: Vec3, d: Vec3, shape: HitShape, range: number, halfAngle: number, structures: Structures): boolean {
  if (shape.kind === 'spheres')
    return shape.spheres.some((s) => sphereInCone(o, d, s, s.r, range, halfAngle) && structures.clear(o, s));
  const { eye, box } = shape;
  const a = capsuleFeetY(eye.y);
  const b = a + box.top;
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const c = { x: eye.x, y: a + ((b - a) * i) / steps, z: eye.z };
    if (sphereInCone(o, d, c, box.radius, range, halfAngle)) return structures.clear(o, eye);
  }
  return false;
}

// Whether the sphere at `c` of radius `r` is within `range` of `o` and any of it within `halfAngle`
// of the ray from there along `d`.
function sphereInCone(o: Vec3, d: Vec3, c: Vec3, r: number, range: number, halfAngle: number): boolean {
  const lx = c.x - o.x;
  const ly = c.y - o.y;
  const lz = c.z - o.z;
  const dist = Math.hypot(lx, ly, lz);
  if (dist > range + r) return false;
  if (dist <= r) return true;
  const cos = (lx * d.x + ly * d.y + lz * d.z) / dist;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  return angle <= halfAngle + Math.asin(Math.min(1, r / dist));
}

export function findHit<T extends Target>(
  shooter: Shooter,
  players: Iterable<T>,
  range: number,
  structures: Structures = WORLD_STRUCTURES,
): Hit<T> | null {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = eyeOf(shooter);
  let best: Hit<T> | null = null;
  let bestT = Math.min(range, structures.raycast(o, dir, range)); // the shot stops at the first wall
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    const hit = rayShape(o, dir, classOf(p.avatar).hitShape(p), bestT);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      best = { target: p, headshot: hit.headshot };
    }
  }
  return best;
}

// How far a ray from `o` along `d` gets, up to `range`: to the first wall or live player other than
// `selfId`. What the camera's centre ray lands on, for the third-person view's aim.
export function reach<T extends Target>(
  o: Vec3,
  d: Vec3,
  players: Iterable<T>,
  range: number,
  selfId: string,
  structures: Structures = WORLD_STRUCTURES,
): number {
  let best = Math.min(range, structures.raycast(o, d, range));
  for (const p of players) {
    if (p.id === selfId || p.dead) continue;
    const hit = rayShape(o, d, classOf(p.avatar).hitShape(p), best);
    if (hit && hit.t < best) best = hit.t;
  }
  return best;
}

// Where the ray first enters the shape within maxT, and whether that's a headshot: in a capsule's
// head band, or on a sphere that is the head.
function rayShape(o: Vec3, d: Vec3, shape: HitShape, maxT: number): { t: number; headshot: boolean } | null {
  if (shape.kind === 'capsule') {
    const t = rayCapsule(o, d, shape.eye, shape.box, maxT);
    return t === null ? null : { t, headshot: isHeadshot(o.y + d.y * t, shape.eye.y, shape.box) };
  }
  let best: { t: number; sphere: Sphere } | null = null;
  for (const s of shape.spheres) {
    const t = raySphere(o, d, s, s.r);
    if (t !== null && t <= maxT && (best === null || t < best.t)) best = { t, sphere: s };
  }
  return best && { t: best.t, headshot: best.sphere.head };
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
