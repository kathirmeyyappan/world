// Floating info cubes. Simulated on the server only; clients interpolate the broadcast positions.
import {
  CUBE_BASE_Y,
  CUBE_BOUNDARY,
  CUBE_FLOAT_AMPLITUDE,
  CUBE_MIN_CENTER_DISTANCE,
  CUBE_MIN_SPACING,
} from './constants';
import type { Rng } from './rng';
import type { CubeState } from './types';

export function createCubes(ids: string[], worldRadius: number, rng: Rng): CubeState[] {
  const positions = distribute(ids.length, worldRadius - 12, rng);
  return ids.map((id, i) => ({
    id,
    pos: { x: positions[i].x, y: CUBE_BASE_Y, z: positions[i].z },
    rot: { x: 0, y: rng() * Math.PI * 2 },
    target: randomTarget(worldRadius, rng),
    time: rng() * Math.PI * 2,
    wanderSpeed: 0.3 + rng() * 0.5,
    floatFrequency: 1.2 + rng() * 0.6,
    rotationSpeed: 0.2 + rng() * 0.3,
  }));
}

export function stepCubes(cubes: CubeState[], dt: number, worldRadius: number, rng: Rng): void {
  const maxR = worldRadius - CUBE_BOUNDARY;
  for (const c of cubes) {
    c.time += dt;
    c.pos.y = CUBE_BASE_Y + Math.sin(c.time * c.floatFrequency) * CUBE_FLOAT_AMPLITUDE;
    c.rot.y += c.rotationSpeed * dt;
    c.rot.x = Math.sin(c.time * 0.5) * 0.1;

    const dx = c.target.x - c.pos.x;
    const dz = c.target.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5 || Math.hypot(c.pos.x, c.pos.z) >= maxR) {
      c.target = randomTarget(worldRadius, rng);
    } else {
      const speed = c.wanderSpeed * Math.min(dist / 5, 1);
      c.pos.x += (dx / dist) * speed * dt;
      c.pos.z += (dz / dist) * speed * dt;
      const r = Math.hypot(c.pos.x, c.pos.z);
      if (r > maxR) {
        c.pos.x *= maxR / r;
        c.pos.z *= maxR / r;
      }
    }
  }
}

function randomTarget(worldRadius: number, rng: Rng): { x: number; z: number } {
  const maxR = worldRadius - CUBE_BOUNDARY;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * maxR;
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

// Rings of evenly spaced slots with jitter, falling back to random placement if a slot collides.
function distribute(count: number, maxRadius: number, rng: Rng): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const rings = Math.ceil(Math.sqrt(count));
  for (let ring = 1; ring <= rings && out.length < count; ring++) {
    const ringRadius = (ring / rings) * maxRadius;
    const slots = Math.min(Math.floor((2 * Math.PI * ringRadius) / CUBE_MIN_SPACING), count - out.length);
    for (let i = 0; i < slots && out.length < count; i++) {
      const a = (i / slots) * Math.PI * 2 + ring * 0.5 + (rng() - 0.5) * 0.3;
      const r = ringRadius + (rng() - 0.5) * (maxRadius / rings) * 0.5;
      const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (valid(p, out)) out.push(p);
    }
  }
  while (out.length < count) {
    let placed = false;
    for (let i = 0; i < 50 && !placed; i++) {
      const a = rng() * Math.PI * 2;
      const r = CUBE_MIN_CENTER_DISTANCE + Math.sqrt(rng()) * (maxRadius - CUBE_MIN_CENTER_DISTANCE);
      const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (valid(p, out)) {
        out.push(p);
        placed = true;
      }
    }
    if (!placed) {
      const a = rng() * Math.PI * 2;
      const r = CUBE_MIN_CENTER_DISTANCE + rng() * (maxRadius - CUBE_MIN_CENTER_DISTANCE);
      out.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
  }
  return out;
}

function valid(p: { x: number; z: number }, existing: { x: number; z: number }[]): boolean {
  if (Math.hypot(p.x, p.z) < CUBE_MIN_CENTER_DISTANCE) return false;
  return existing.every((o) => Math.hypot(p.x - o.x, p.z - o.z) >= CUBE_MIN_SPACING);
}
