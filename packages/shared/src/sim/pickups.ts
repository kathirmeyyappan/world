// Pickups: things floating in the world that a player takes by walking into them. Each pickup
// area keeps up to `count` of one kind drifting about its region, all there from the start, and
// brings one back every `respawnSeconds` while it's short. A drop (dropPickup) is one left at a
// spot, belonging to no area: it bobs and spins where it was left and never comes back once taken.
// Simulated on the server only, like the cubes; clients draw the broadcast positions.
//
// A new kind is a row in PICKUPS (how high it floats, how close you must be, what taking it does)
// and a shape in the client's render/Pickups.ts; where it appears is content/pickups.ts.
import { MAX_HEARTS } from './health';
import { nextPointInRegion, randomPointInRegion, type Region } from './regions';
import type { Rng } from './rng';
import type { PlayerState, Vec3 } from './types';

export type PickupKind = 'heart' | 'big-heart';

export interface PickupSpec {
  kind: PickupKind;
  height: number; // metres above its region's floor that it floats at
  reach: number; // metres across the floor from a player's eye line at which they take it
  use: (p: PlayerState) => boolean; // what taking it does; false if it's no use to them, and it stays
}

export const PICKUPS: Record<PickupKind, PickupSpec> = {
  heart: { kind: 'heart', height: 1.4, reach: 1, use: heal(3) }, // just under eye level, half a cube's height
  'big-heart': { kind: 'big-heart', height: 1.4, reach: 1.5, use: heal(MAX_HEARTS) }, // drawn twice the size
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
  area: PickupArea | null; // the area it belongs to and drifts inside; null for a drop
  floor: number; // height of the floor it floats over
  pos: Vec3;
  ry: number; // spin about the vertical, radians
  target: { x: number; z: number };
  time: number;
  speed: number; // metres per second at full drift
}

// Every pickup in a room, its areas, and each area's countdown to its next one.
export interface PickupField {
  areas: readonly PickupArea[];
  items: PickupState[];
  cooldowns: Map<PickupArea, number>;
  nextId: number;
}

const MARGIN = 1.5; // metres a pickup keeps from its region's edge
const BOB = 0.15; // metres up and down
const BOB_HZ = 1.5;
const SPIN = 1.4; // radians per second

export function createPickups(areas: readonly PickupArea[], rng: Rng): PickupField {
  const field: PickupField = {
    areas,
    items: [],
    cooldowns: new Map(areas.map((a) => [a, a.respawnSeconds])),
    nextId: 1,
  };
  for (const area of areas) for (let k = 0; k < area.count; k++) spawn(field, area, rng);
  return field;
}

// Drifts, bobs and spins every pickup, and brings one back to each area that's been short for its
// respawn time (the countdown restarts whenever an area is full, so it runs from the first taking).
export function stepPickups(field: PickupField, dt: number, rng: Rng): void {
  for (const p of field.items) {
    p.time += dt;
    p.ry += SPIN * dt;
    p.pos.y = p.floor + PICKUPS[p.kind].height + Math.sin(p.time * BOB_HZ * 2 * Math.PI) * BOB;
    if (!p.area) continue; // a drop stays where it was left
    const { region } = p.area;
    const dx = p.target.x - p.pos.x;
    const dz = p.target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) p.target = nextPointInRegion(region, MARGIN, p.pos, rng);
    else {
      const step = p.speed * Math.min(dist / 3, 1) * dt;
      p.pos.x += (dx / dist) * step;
      p.pos.z += (dz / dist) * step;
    }
  }
  for (const area of field.areas) {
    if (field.items.filter((p) => p.area === area).length >= area.count) {
      field.cooldowns.set(area, area.respawnSeconds);
      continue;
    }
    const wait = (field.cooldowns.get(area) ?? area.respawnSeconds) - dt;
    if (wait > 0) {
      field.cooldowns.set(area, wait);
      continue;
    }
    spawn(field, area, rng);
    field.cooldowns.set(area, area.respawnSeconds);
  }
}

// Lets a living player take whatever they're touching and can use; what they take is gone.
export function takePickups(field: PickupField, p: PlayerState, eyeHeight: number): void {
  if (p.dead) return;
  const taken = new Set<PickupState>();
  for (const pickup of field.items)
    if (touches(pickup, p.pos, eyeHeight) && PICKUPS[pickup.kind].use(p)) taken.add(pickup);
  if (taken.size > 0) field.items = field.items.filter((pickup) => !taken.has(pickup));
}

// Within reach across the floor of a player whose eyes are at `eye`, and between their feet and a
// little over their head.
function touches(pickup: PickupState, eye: Vec3, eyeHeight: number): boolean {
  return (
    Math.hypot(pickup.pos.x - eye.x, pickup.pos.z - eye.z) <= PICKUPS[pickup.kind].reach &&
    pickup.pos.y >= eye.y - eyeHeight - 0.3 &&
    pickup.pos.y <= eye.y + 0.6
  );
}

// Gives back `hearts`, up to MAX_HEARTS; no use to someone already at full health.
function heal(hearts: number): (p: PlayerState) => boolean {
  return (p) => {
    if (p.hearts >= MAX_HEARTS) return false;
    p.hearts = Math.min(MAX_HEARTS, p.hearts + hearts);
    return true;
  };
}

// A pickup of `kind` left floating over `feet` (where a player died, say) until someone takes it.
export function dropPickup(field: PickupField, kind: PickupKind, feet: Vec3, rng: Rng): void {
  add(field, kind, null, feet, rng);
}

function spawn(field: PickupField, area: PickupArea, rng: Rng): void {
  const at = randomPointInRegion(area.region, MARGIN, rng);
  add(field, area.kind, area, { x: at.x, y: area.region.y, z: at.z }, rng);
}

// A new pickup over the floor point `at`, drifting about `area`'s region, or with none, staying put.
function add(field: PickupField, kind: PickupKind, area: PickupArea | null, at: Vec3, rng: Rng): void {
  field.items.push({
    id: `${kind}-${field.nextId++}`,
    kind,
    area,
    floor: at.y,
    pos: { x: at.x, y: at.y + PICKUPS[kind].height, z: at.z },
    ry: rng() * Math.PI * 2,
    target: area ? randomPointInRegion(area.region, MARGIN, rng) : { x: at.x, z: at.z },
    time: rng() * 10,
    speed: area ? 0.4 + rng() * 0.4 : 0,
  });
}
