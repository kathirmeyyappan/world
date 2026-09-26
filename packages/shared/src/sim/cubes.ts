// Floating info cubes. Simulated on the server only; clients interpolate the broadcast positions.
// Cubes are spread across the world's discs by area and wander within the disc they're in.
import {
  CUBE_BASE_Y,
  CUBE_BOUNDARY,
  CUBE_FLOAT_AMPLITUDE,
  CUBE_MIN_CENTER_DISTANCE,
  CUBE_MIN_SPACING,
} from './constants';
import type { Rng } from './rng';
import type { CubeState } from './types';
import { WORLD_SHAPE, clampToWorld, nearestDisc, randomPointInDisc, worldDiscs, type Disc, type WorldPart } from './world';

export function createCubes(ids: string[], shape: WorldPart[], rng: Rng): CubeState[] {
  const discs = worldDiscs(shape);
  const counts = splitByArea(ids.length, discs);
  const positions: { x: number; z: number }[] = [];
  discs.forEach((disc, i) => positions.push(...distribute(counts[i], disc, rng)));
  return ids.map((id, i) => ({
    id,
    pos: { x: positions[i].x, y: CUBE_BASE_Y, z: positions[i].z },
    rot: { x: 0, y: rng() * Math.PI * 2 },
    target: randomPointInDisc(nearestDisc(positions[i].x, positions[i].z, shape), CUBE_BOUNDARY, rng),
    time: rng() * Math.PI * 2,
    wanderSpeed: 0.3 + rng() * 0.5,
    floatFrequency: 1.2 + rng() * 0.6,
    rotationSpeed: 0.2 + rng() * 0.3,
  }));
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
      c.target = randomPointInDisc(nearestDisc(c.pos.x, c.pos.z, shape), CUBE_BOUNDARY, rng);
    } else {
      const speed = c.wanderSpeed * Math.min(dist / 5, 1);
      c.pos.x += (dx / dist) * speed * dt;
      c.pos.z += (dz / dist) * speed * dt;
      clampToWorld(c.pos, CUBE_BOUNDARY, shape);
    }
  }
}

// How many cubes each disc gets, proportional to area, every disc getting at least one when
// there are enough cubes to go round.
function splitByArea(count: number, discs: Disc[]): number[] {
  const total = discs.reduce((s, d) => s + d.r * d.r, 0);
  const counts = discs.map((d) => Math.floor((count * d.r * d.r) / total));
  if (count >= discs.length) for (let i = 0; i < counts.length; i++) counts[i] = Math.max(1, counts[i]);
  let placed = counts.reduce((s, n) => s + n, 0);
  for (let i = 0; placed < count; i = (i + 1) % counts.length, placed++) counts[i]++;
  for (let i = 0; placed > count; i = (i + 1) % counts.length) {
    if (counts[i] > 1) {
      counts[i]--;
      placed--;
    }
  }
  return counts;
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
      const p = at(rng() * Math.PI * 2, CUBE_MIN_CENTER_DISTANCE + Math.sqrt(rng()) * Math.max(0, maxRadius - CUBE_MIN_CENTER_DISTANCE));
      if (valid(p, out, disc)) {
        out.push(p);
        placed = true;
      }
    }
    if (!placed) out.push(at(rng() * Math.PI * 2, CUBE_MIN_CENTER_DISTANCE + rng() * Math.max(0, maxRadius - CUBE_MIN_CENTER_DISTANCE)));
  }
  return out;
}

function valid(p: { x: number; z: number }, existing: { x: number; z: number }[], disc: Disc): boolean {
  if (Math.hypot(p.x - disc.x, p.z - disc.z) < CUBE_MIN_CENTER_DISTANCE) return false;
  return existing.every((o) => Math.hypot(p.x - o.x, p.z - o.z) >= CUBE_MIN_SPACING);
}
