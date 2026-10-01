// Pickups: things floating about a region of the world that a player takes by walking into them.
// Each pickup area keeps up to `count` of one kind, all there from the start, and brings one back
// every `respawnSeconds` while it's short. Simulated on the server only, like the cubes, with the
// same drift, bob and spin; clients draw the broadcast positions. Adding a kind means a row in
// PICKUPS, what taking it does in Room.takePickups, and a shape in the client's render/Pickups.ts.
import type { Region } from './regions';
import { randomPointInRegion } from './regions';
import type { Rng } from './rng';
import type { Vec3 } from './types';

export type PickupKind = 'heart';

export interface PickupSpec {
  kind: PickupKind;
  height: number; // metres above its region's floor that it floats at
  reach: number; // metres across the floor from a player's eye line at which they take it
  heal: number; // hearts it gives back, up to MAX_HEARTS
}

export const PICKUPS: Record<PickupKind, PickupSpec> = {
  heart: { kind: 'heart', height: 1.4, reach: 1, heal: 3 }, // just under eye level, half a cube's height
};

export interface PickupArea {
  region: Region;
  kind: PickupKind;
  count: number;
  respawnSeconds: number;
}

export interface PickupState {
  id: string;
  kind: PickupKind;
  area: number; // index into the areas it was made from
  pos: Vec3;
  ry: number; // spin about the vertical, radians
  target: { x: number; z: number };
  time: number;
  speed: number; // metres per second at full drift
}

// Every pickup in a room, and each area's countdown to its next one.
export interface PickupField {
  items: PickupState[];
  cooldowns: number[];
  nextId: number;
}

const MARGIN = 1.5; // metres a pickup keeps from its region's edge
const BOB = 0.15; // metres up and down
const BOB_HZ = 1.5;
const SPIN = 1.4; // radians per second

export function createPickups(areas: readonly PickupArea[], rng: Rng): PickupField {
  const field: PickupField = { items: [], cooldowns: areas.map((a) => a.respawnSeconds), nextId: 1 };
  areas.forEach((area, i) => {
    for (let k = 0; k < area.count; k++) spawn(field, areas, i, rng);
  });
  return field;
}

// Drifts, bobs and spins every pickup, and brings one back to each area that's been short for its
// respawn time (the countdown restarts whenever an area is full, so it runs from the first taking).
export function stepPickups(field: PickupField, areas: readonly PickupArea[], dt: number, rng: Rng): void {
  for (const p of field.items) {
    const area = areas[p.area];
    p.time += dt;
    p.ry += SPIN * dt;
    p.pos.y = area.region.y + PICKUPS[p.kind].height + Math.sin(p.time * BOB_HZ * 2 * Math.PI) * BOB;
    const dx = p.target.x - p.pos.x;
    const dz = p.target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) p.target = randomPointInRegion(area.region, MARGIN, rng);
    else {
      const step = p.speed * Math.min(dist / 3, 1) * dt;
      p.pos.x += (dx / dist) * step;
      p.pos.z += (dz / dist) * step;
    }
  }
  areas.forEach((area, i) => {
    if (field.items.filter((p) => p.area === i).length >= area.count) {
      field.cooldowns[i] = area.respawnSeconds;
      return;
    }
    field.cooldowns[i] -= dt;
    if (field.cooldowns[i] <= 0) {
      spawn(field, areas, i, rng);
      field.cooldowns[i] = area.respawnSeconds;
    }
  });
}

// The pickups a player with eyes at `eye` is touching: within reach across the floor, and between
// their feet and a little over their head.
export function touching(field: PickupField, eye: Vec3, eyeHeight: number): PickupState[] {
  return field.items.filter(
    (p) =>
      Math.hypot(p.pos.x - eye.x, p.pos.z - eye.z) <= PICKUPS[p.kind].reach &&
      p.pos.y >= eye.y - eyeHeight - 0.3 &&
      p.pos.y <= eye.y + 0.6,
  );
}

export function removePickup(field: PickupField, pickup: PickupState): void {
  field.items = field.items.filter((p) => p !== pickup);
}

function spawn(field: PickupField, areas: readonly PickupArea[], area: number, rng: Rng): void {
  const { region, kind } = areas[area];
  const at = randomPointInRegion(region, MARGIN, rng);
  field.items.push({
    id: `${kind}-${field.nextId++}`,
    kind,
    area,
    pos: { x: at.x, y: region.y + PICKUPS[kind].height, z: at.z },
    ry: rng() * Math.PI * 2,
    target: randomPointInRegion(region, MARGIN, rng),
    time: rng() * 10,
    speed: 0.4 + rng() * 0.4,
  });
}
