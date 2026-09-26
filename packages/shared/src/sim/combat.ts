// Hitscan shooting, resolved on the server from the shooter's own position and look direction.
// A player is a vertical capsule from feet to just above the eyes; the nearest one the ray
// passes through within range is the hit.
import { EYE_HEIGHT, GUN_RANGE, HIT_RADIUS } from './constants';
import type { PlayerState, Vec3 } from './types';

// Unit vector the player is looking along. Matches the client camera: yaw 0 faces +z,
// positive pitch looks down.
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: Math.cos(yaw) * c };
}

export function findHit(shooter: PlayerState, players: Iterable<PlayerState>): PlayerState | null {
  const dir = lookDirection(shooter.yaw, shooter.pitch);
  const o = shooter.pos;
  let best: PlayerState | null = null;
  let bestT = GUN_RANGE;
  for (const p of players) {
    if (p.id === shooter.id || p.dead) continue;
    const t = rayCapsule(o, dir, p.pos, bestT);
    if (t !== null && t < bestT) {
      bestT = t;
      best = p;
    }
  }
  return best;
}

// Distance along the ray to a capsule around `eye` (feet at eye.y - EYE_HEIGHT, top a bit above
// the eye), or null. Checks the ray against the capsule's axis segment plus HIT_RADIUS.
function rayCapsule(o: Vec3, d: Vec3, eye: Vec3, maxT: number): number | null {
  const a = { x: eye.x, y: eye.y - EYE_HEIGHT, z: eye.z };
  const b = { x: eye.x, y: eye.y + 0.3, z: eye.z };
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
