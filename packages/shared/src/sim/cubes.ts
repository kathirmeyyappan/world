// Floating info cubes. Simulated on the server only; clients interpolate the broadcast positions.
// All cubes live in the main disc and wander it evenly: each new target is uniform over the disc,
// far from where the cube is now, and away from the other cubes' targets.
import {
  CUBE_BASE_Y,
  CUBE_BOUNDARY,
  CUBE_FLOAT_AMPLITUDE,
  CUBE_MIN_CENTER_DISTANCE,
  CUBE_MIN_SPACING,
} from './constants';
import type { Rng } from './rng';
import type { CubeState } from './types';
import { WORLD_SHAPE, clampToWorld, randomPointInDisc, worldDiscs, type Disc, type WorldPart } from './world';

const MIN_TARGET_TRAVEL = 20; // a new target is at least this far away, so cubes cross the area
const MIN_TARGET_SPACING = 12; // and this far from the other cubes' targets, so they spread out

export function createCubes(ids: string[], shape: WorldPart[], rng: Rng): CubeState[] {
  const home = mainDisc(shape);
  const positions = distribute(ids.length, home, rng);
  const cubes: CubeState[] = ids.map((id, i) => ({
    id,
    pos: { x: positions[i].x, y: CUBE_BASE_Y, z: positions[i].z },
    rot: { x: 0, y: rng() * Math.PI * 2 },
    target: { x: positions[i].x, z: positions[i].z },
    time: rng() * Math.PI * 2,
    wanderSpeed: 0.3 + rng() * 0.5,
    floatFrequency: 1.2 + rng() * 0.6,
    rotationSpeed: 0.2 + rng() * 0.3,
  }));
  for (const c of cubes) c.target = pickTarget(c, cubes, home, rng);
  return cubes;
}

export function stepCubes(cubes: CubeState[], dt: number, shape: WorldPart[] = WORLD_SHAPE, rng: Rng): void {
  for (const c of cubes) {
    c.time += dt;
    c.pos.y = CUBE_BASE_Y + Math.sin(c.time * c.floatFrequency) * CUBE_FLOAT_AMPLITUDE;
    c.rot.y += c.rotationSpeed * dt;
    c.rot.x = Math.sin(c.time * 0.5) * 0.1;

    const dx = c.target.x - c.pos.x;
    const dz = c.target.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      c.target = pickTarget(c, cubes, mainDisc(shape), rng);
    } else {
      const speed = c.wanderSpeed * Math.min(dist / 5, 1);
      c.pos.x += (dx / dist) * speed * dt;
      c.pos.z += (dz / dist) * speed * dt;
      clampToWorld(c.pos, CUBE_BOUNDARY, shape);
    }
  }
}

function mainDisc(shape: WorldPart[]): Disc {
  const disc = worldDiscs(shape)[0];
  if (!disc) throw new Error('world shape has no discs');
  return disc;
}

// Uniform over the disc, but rejected when too close to the cube's current spot or to another
// cube's target. Falls back to plain uniform after enough tries so it can never stall.
function pickTarget(c: CubeState, cubes: CubeState[], disc: Disc, rng: Rng): { x: number; z: number } {
  for (let i = 0; i < 40; i++) {
    const p = randomPointInDisc(disc, CUBE_BOUNDARY, rng);
    if (Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < MIN_TARGET_TRAVEL) continue;
    if (Math.hypot(p.x - disc.x, p.z - disc.z) < CUBE_MIN_CENTER_DISTANCE) continue;
    if (cubes.some((o) => o !== c && Math.hypot(p.x - o.target.x, p.z - o.target.z) < MIN_TARGET_SPACING)) continue;
    return p;
  }
  return randomPointInDisc(disc, CUBE_BOUNDARY, rng);
}

// Rings of evenly spaced slots with jitter inside one disc, falling back to random placement
// if a slot collides.
function distribute(count: number, disc: Disc, rng: Rng): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const maxRadius = disc.r - 12;
  const rings = Math.ceil(Math.sqrt(count));
  const at = (a: number, r: number) => ({ x: disc.x + Math.cos(a) * r, z: disc.z + Math.sin(a) * r });
  for (let ring = 1; ring <= rings && out.length < count; ring++) {
    const ringRadius = (ring / rings) * maxRadius;
    const slots = Math.min(Math.floor((2 * Math.PI * ringRadius) / CUBE_MIN_SPACING), count - out.length);
    for (let i = 0; i < slots && out.length < count; i++) {
      const a = (i / slots) * Math.PI * 2 + ring * 0.5 + (rng() - 0.5) * 0.3;
      const r = ringRadius + (rng() - 0.5) * (maxRadius / rings) * 0.5;
      const p = at(a, r);
      if (valid(p, out, disc)) out.push(p);
    }
  }
  while (out.length < count) {
    let placed = false;
    for (let i = 0; i < 50 && !placed; i++) {
      const p = at(
        rng() * Math.PI * 2,
        CUBE_MIN_CENTER_DISTANCE + Math.sqrt(rng()) * Math.max(0, maxRadius - CUBE_MIN_CENTER_DISTANCE),
      );
      if (valid(p, out, disc)) {
        out.push(p);
        placed = true;
      }
    }
    if (!placed)
      out.push(
        at(rng() * Math.PI * 2, CUBE_MIN_CENTER_DISTANCE + rng() * Math.max(0, maxRadius - CUBE_MIN_CENTER_DISTANCE)),
      );
  }
  return out;
}

function valid(p: { x: number; z: number }, existing: { x: number; z: number }[], disc: Disc): boolean {
  if (Math.hypot(p.x - disc.x, p.z - disc.z) < CUBE_MIN_CENTER_DISTANCE) return false;
  return existing.every((o) => Math.hypot(p.x - o.x, p.z - o.z) >= CUBE_MIN_SPACING);
}
