// A dragon: a head that flies where its rider looks, trailing a body that follows the way it came.
// The sim half of the dragon class (classes.ts). The head is `pos` (its eyes), a sphere HEAD_RADIUS
// round it that walls, undersides and shots meet; the body is SPINE_POINTS points behind it, each
// pulled after the one before whenever the head moves, so a turn runs down the body as a curve and
// the body stays as it is when the head stops. Only the forward key flies: the head goes the way it
// was going, bending toward the look no tighter than TURN_RADIUS, so the body never folds on
// itself. The head itself turns toward the look only as far as the neck lets it (HEAD_YAW round,
// HEAD_PITCH up or down), and its breath goes where the head points. The head keeps MIN_ALTITUDE
// above whatever is under it, is too big for any doorway, and has the whole sky out to the world's
// reach, the void between its parts included. A new one rises out of the ground where its rider
// stood, head up and body straight below, and climbs straight on with the forward key until
// EMERGE_POINTS of its spine are out; only then is it free to fly.
import type { ClassSpec, HitShape, Sphere } from './classes';
import type { Body, Structures } from './collision';
import type { Shooter, Target } from './combat';
import { EYE_HEIGHT, GRAVITY, TICK_RATE } from './constants';
import { lookDirection } from './look';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { worldReach, type WorldPart } from './world';

export const HEAD_RADIUS = 2; // metres: the head's sphere, what walls, undersides and headshots meet
export const BODY_RADIUS = 1.2; // metres: the body's, round each spine point
export const MIN_ALTITUDE = 4; // metres the head keeps above whatever is under it
export const CRUISE_SPEED = 10; // m/s flat out
export const TURN_RADIUS = 8; // metres: the tightest arc the head flies
export const SPINE_SPACING = 1.5; // metres between spine points, at most
export const SPINE_POINTS = 20; // so the body runs 30 m behind the head
export const HEAD_YAW = 1.2; // radians the head can turn round from the way the neck runs
export const HEAD_PITCH = 0.8; // and up or down from it
export const EMERGE_POINTS = 12; // spine points out of the ground before a new one may leave the way it rose
const HEAD_TURN_RATE = 4; // radians per second the head comes round at
const SPEED_EASE = 0.6; // seconds to get most of the way up to cruise or down to a stop
const RISE_SPEED = 3; // m/s a new dragon's head comes out of the ground at
const CLIMB_SPEED = 6; // m/s the head lifts at where the ground under it rises, to keep MIN_ALTITUDE
const GROUND_SAMPLES = 8; // spots round the head's edge the ground is read at, besides its centre
const SINK_SPEED = 6; // m/s a dead body's points settle onto what's under them at
const ROAR_SECONDS = 3; // one roar at a time
const CORPSE_HEARTS_EVERY = 5; // spine points between the hearts a dead one leaves, after the one at its head

const UP: Vec3 = { x: 0, y: 1, z: 0 };

export interface DragonState {
  dir: Vec3; // the way the head is going, a unit vector
  speed: number; // m/s along it
  head: Vec3; // the way the head points, a unit vector: the look, as far round as the neck lets it
  risen: boolean; // EMERGE_POINTS of the spine out of the ground it rose from, and free to fly
  spine: number[]; // x, y, z of each spine point, nearest the head first, each within SPINE_SPACING of the last
}

// A body straight down from the head, in the ground it rises out of, heading up.
export function createDragon(head: Vec3): DragonState {
  const spine: number[] = [];
  for (let i = 1; i <= SPINE_POINTS; i++) spine.push(head.x, round(head.y - i * SPINE_SPACING), head.z);
  return { dir: { ...UP }, speed: 0, head: { ...UP }, risen: false, spine };
}

export const DRAGON: ClassSpec = {
  id: 'dragon',
  hearts: 40,
  heartRow: 8,
  kit: false,
  bots: false,
  corpseSeconds: 30,
  actions: {
    'roar-1': { key: 'KeyA', mode: 'tap' },
    'roar-2': { key: 'KeyS', mode: 'tap' },
    'roar-3': { key: 'KeyD', mode: 'tap' },
  },
  actionTicks: ROAR_SECONDS * TICK_RATE,
  fits,
  enter(p) {
    p.dragon = createDragon(p.pos);
  },
  exit(p) {
    p.dragon = null;
  },
  step: stepDragon,
  aim: (p: Shooter) => p.dragon?.head ?? lookDirection(p.yaw, p.pitch),
  hitShape,
  lies,
};

// The head against structures: a wall is anything its sphere reaches.
function headBody(y: number): Body {
  return { head: y + HEAD_RADIUS, reach: y - HEAD_RADIUS, radius: HEAD_RADIUS };
}

// Whether a dragon can rise where someone's eyes are at `pos`: the sky clear from the floor there up
// to where its head will be once it's free to fly, and nothing round about the head on the way up.
function fits(pos: Vec3, structures: Structures): boolean {
  const feet = pos.y - EYE_HEIGHT;
  const top = feet + EMERGE_POINTS * SPINE_SPACING;
  if (structures.ceilingAt(pos.x, pos.z, feet) < top + HEAD_RADIUS) return false;
  for (let y = feet + MIN_ALTITUDE; y <= top; y += HEAD_RADIUS)
    if (structures.touches(pos.x, pos.z, headBody(y))) return false;
  return true;
}

export function stepDragon(
  p: PlayerState,
  input: InputFrame | null,
  dt: number,
  shape: WorldPart[],
  structures: Structures,
): number {
  const d = p.dragon ?? (p.dragon = createDragon(p.pos));
  if (p.dead) {
    settle(p, d, dt, structures);
    return 0;
  }
  // Nothing moves without a frame: a tick the server runs while a frame is late would carry the
  // head on where the rider's own prediction, which steps once per frame, did not.
  if (!input) return 0;
  if (d.risen) fly(p, d, input, dt, shape, structures);
  else emerge(p, d, input, dt, structures);
  return 0;
}

// Out of the ground: the head comes up on its own to MIN_ALTITUDE, then climbs straight on with
// the forward key, looking straight up all the while, until EMERGE_POINTS of the spine are out.
function emerge(p: PlayerState, d: DragonState, input: InputFrame, dt: number, structures: Structures): void {
  const head = p.pos;
  const ground = structures.groundAt(head.x, head.z, head.y);
  if (head.y < ground + MIN_ALTITUDE) {
    head.y = Math.min(ground + MIN_ALTITUDE, head.y + RISE_SPEED * dt);
    d.speed = 0;
  } else {
    ease(d, input, dt);
    head.y = Math.min(structures.ceilingAt(head.x, head.z, head.y) - HEAD_RADIUS, head.y + d.speed * dt);
  }
  follow(d.spine, head);
  d.risen = d.spine[(EMERGE_POINTS - 1) * 3 + 1] >= ground;
}

function fly(
  p: PlayerState,
  d: DragonState,
  input: InputFrame,
  dt: number,
  shape: WorldPart[],
  structures: Structures,
): void {
  const head = p.pos;
  const look = lookDirection(p.yaw, p.pitch);
  // The head comes round toward the look, as far as the neck lets it, moving or not.
  d.head = turnToward(d.head, headTarget(neckOf(d, head), look), HEAD_TURN_RATE * dt);
  ease(d, input, dt);
  if (d.speed === 0) return;
  const dir = (d.dir = turnToward(d.dir, look, (d.speed / TURN_RADIUS) * dt));
  const step = d.speed * dt;
  const from = { ...head };
  const ground = groundUnder(head, structures);
  // Up or down first, stopped under any underside and MIN_ALTITUDE over whatever is below (a dive
  // stops there; where the ground rises, the head climbs at CLIMB_SPEED); then across, pushed out
  // of walls, and back where it was if that still leaves the head in one (a doorway's jambs, a
  // corner): too big to get through, it stops there.
  head.y += dir.y * step;
  const ceiling = structures.ceilingAt(from.x, from.z, from.y);
  if (head.y + HEAD_RADIUS > ceiling) head.y = ceiling - HEAD_RADIUS;
  const floor = ground + MIN_ALTITUDE;
  if (head.y < floor) head.y = Math.min(floor, Math.max(head.y, from.y) + CLIMB_SPEED * dt);
  structures.move(head, dir.x * step, dir.z * step, headBody(head.y));
  clampToSky(head, shape);
  if (structures.touches(head.x, head.z, headBody(head.y))) {
    head.x = from.x;
    head.y = from.y;
    head.z = from.z;
  }
  follow(d.spine, head);
}

// The highest ground under any of the head: read at its centre and round its edge, so a merlon or
// a step at the edge lifts the head over itself before the head reaches it.
function groundUnder(head: Vec3, structures: Structures): number {
  let ground = structures.groundAt(head.x, head.z, head.y);
  for (let i = 0; i < GROUND_SAMPLES; i++) {
    const a = (i / GROUND_SAMPLES) * 2 * Math.PI;
    const x = head.x + Math.cos(a) * HEAD_RADIUS;
    const z = head.z + Math.sin(a) * HEAD_RADIUS;
    ground = Math.max(ground, structures.groundAt(x, z, head.y));
  }
  return ground;
}

// Keeps the head within the world's reach.
function clampToSky(head: Vec3, shape: WorldPart[]): void {
  const reach = worldReach(shape) - HEAD_RADIUS;
  const out = Math.hypot(head.x, head.z);
  if (out > reach) {
    head.x *= reach / out;
    head.z *= reach / out;
  }
}

// Toward cruise with the forward key held, else to a stop.
function ease(d: DragonState, input: InputFrame, dt: number): void {
  const want = input.my > 0 ? CRUISE_SPEED : 0;
  d.speed += (want - d.speed) * Math.min(1, dt / SPEED_EASE);
  if (d.speed < 0.2) d.speed = 0;
}

// Where the head can point to follow `look`: round from the way the `neck` runs by no more than
// HEAD_YAW, and up or down from it by no more than HEAD_PITCH, so a look over the shoulder turns
// the head sideways rather than tucking it under. With the neck straight up or down, any way round
// is as near as another, so only the pitch is held.
function headTarget(neck: Vec3, look: Vec3): Vec3 {
  const neckPitch = Math.asin(Math.max(-1, Math.min(1, neck.y)));
  const lookYaw = Math.atan2(look.x, look.z);
  const pitch = neckPitch + clamp(Math.asin(Math.max(-1, Math.min(1, look.y))) - neckPitch, HEAD_PITCH);
  let yaw = lookYaw;
  if (Math.abs(neck.y) < 0.99) {
    const neckYaw = Math.atan2(neck.x, neck.z);
    let round = lookYaw - neckYaw;
    round -= Math.round(round / (2 * Math.PI)) * 2 * Math.PI;
    yaw = neckYaw + clamp(round, HEAD_YAW);
  }
  return { x: Math.cos(pitch) * Math.sin(yaw), y: Math.sin(pitch), z: Math.cos(pitch) * Math.cos(yaw) };
}

function clamp(v: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, v));
}

// The way the neck runs: from the first spine point up to the head.
function neckOf(d: DragonState, head: Vec3): Vec3 {
  const x = head.x - d.spine[0];
  const y = head.y - d.spine[1];
  const z = head.z - d.spine[2];
  const len = Math.hypot(x, y, z);
  return len > 1e-6 ? { x: x / len, y: y / len, z: z / len } : d.dir;
}

// Dead: the head drops and comes to rest on whatever is under it, and the body's points sink onto
// what's under each of them, so it drapes over edges.
function settle(p: PlayerState, d: DragonState, dt: number, structures: Structures): void {
  const head = p.pos;
  const top = structures.groundAt(head.x, head.z, head.y);
  p.vy -= GRAVITY * dt;
  head.y += p.vy * dt;
  if (head.y < top + HEAD_RADIUS) {
    head.y = top + HEAD_RADIUS;
    p.vy = 0;
  }
  const spine = d.spine;
  for (let i = 1; i < spine.length; i += 3) {
    const rest = structures.groundAt(spine[i - 1], spine[i + 1], spine[i]) + BODY_RADIUS;
    if (spine[i] > rest) spine[i] = round(Math.max(rest, spine[i] - SINK_SPEED * dt));
  }
}

// `from` turned toward `to` by at most `max` radians, both unit vectors. Straight back the way it's
// going, it turns to the right: as good a way round as any.
function turnToward(from: Vec3, to: Vec3, max: number): Vec3 {
  const angle = Math.acos(Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z)));
  if (angle <= max) return to;
  if (angle > Math.PI - 1e-3) {
    const flat = Math.hypot(from.x, from.z);
    return turnToward(from, flat > 1e-6 ? { x: from.z / flat, y: 0, z: -from.x / flat } : { x: 1, y: 0, z: 0 }, max);
  }
  const a = Math.sin(angle - max) / Math.sin(angle);
  const b = Math.sin(max) / Math.sin(angle);
  const x = a * from.x + b * to.x;
  const y = a * from.y + b * to.y;
  const z = a * from.z + b * to.z;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

// Pulls each spine point after the one before it wherever the head's move has left it more than
// SPINE_SPACING behind.
function follow(spine: number[], head: Vec3): void {
  let lx = head.x;
  let ly = head.y;
  let lz = head.z;
  for (let i = 0; i < spine.length; i += 3) {
    const dx = spine[i] - lx;
    const dy = spine[i + 1] - ly;
    const dz = spine[i + 2] - lz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > SPINE_SPACING) {
      const k = SPINE_SPACING / dist;
      spine[i] = round(lx + dx * k);
      spine[i + 1] = round(ly + dy * k);
      spine[i + 2] = round(lz + dz * k);
    }
    lx = spine[i];
    ly = spine[i + 1];
    lz = spine[i + 2];
  }
}

// To the centimetre: the spine goes out in every snapshot.
function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function hitShape(p: Target): HitShape {
  const spheres: Sphere[] = [{ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: HEAD_RADIUS, head: true }];
  const spine = p.dragon?.spine ?? [];
  for (let i = 0; i < spine.length; i += 3)
    spheres.push({ x: spine[i], y: spine[i + 1], z: spine[i + 2], r: BODY_RADIUS, head: false });
  return { kind: 'spheres', spheres };
}

// Under the head and under every CORPSE_HEARTS_EVERY-th spine point.
function lies(p: PlayerState, structures: Structures): Vec3[] {
  const under = (x: number, y: number, z: number): Vec3 => ({ x, y: structures.groundAt(x, z, y), z });
  const points = [under(p.pos.x, p.pos.y, p.pos.z)];
  const spine = p.dragon?.spine ?? [];
  for (let i = (CORPSE_HEARTS_EVERY - 1) * 3; i < spine.length; i += CORPSE_HEARTS_EVERY * 3)
    points.push(under(spine[i], spine[i + 1], spine[i + 2]));
  return points;
}
