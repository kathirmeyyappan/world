// A dragon: a head that flies where its rider looks, trailing a body that follows the way it came.
// The sim half of the dragon class (classes.ts). The head is `pos` (its eyes), a sphere round it
// that walls, undersides and shots meet; the body is a chain of spine points behind it, each pulled
// after the one before whenever the head moves, so a turn runs down the body as a curve and the
// body stays as it is when the head stops. The chain's links, the head's and body's size and how
// fast and how tight it flies are the skin's (DragonShape, on its row in AVATARS), so a skin with a
// long rigid stretch of body has one long link there. Only the forward key flies: the head goes
// the way it was going, bending toward the look no tighter than the shape's turn radius, so the
// body never folds on itself. The head itself turns toward the look only as far as the neck lets
// it (HEAD_YAW round, HEAD_PITCH up or down), and its breath goes where the head points. The head
// keeps MIN_ALTITUDE above whatever is under it, is too big for any doorway, and has the whole sky
// out to the world's reach, the void between its parts included. A new one rises out of the ground
// where its rider stood, head up and body straight below, and climbs straight on by itself,
// whatever the keys, until the whole of its spine is out; only then is it free to fly. Until then
// nothing can hit it: a rider is caught half in the ground, unable to steer, and would be a
// sitting duck.
import { AVATARS, type AvatarId } from './avatars';
import type { ClassSpec, HitPart, HitShape, Sphere } from './classes';
import type { Body, Structures } from './collision';
import type { Shooter, Target } from './combat';
import { EYE_HEIGHT, TICK_RATE } from './constants';
import { lookDirection } from './look';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { worldReach, type WorldPart } from './world';

export const MIN_ALTITUDE = 5; // metres the head keeps above whatever is under it
export const HEAD_YAW = 0.5; // radians the head can turn round from the way the neck runs
export const HEAD_PITCH = 0.5; // and up or down from it
const HEAD_TURN_RATE = 4; // radians per second the head comes round at
const SPEED_EASE = 0.6; // seconds to get most of the way up to cruise or down to a stop
const RISE_SPEED = 3.75; // m/s a new dragon's head comes out of the ground at
const CLIMB_SPEED = 7.5; // m/s the head lifts at where the ground under it rises, to keep MIN_ALTITUDE
const GROUND_SAMPLES = 8; // spots round the head's edge the ground is read at, besides its centre
const SINK_SPEED = 6; // m/s a dead body's points settle onto what's under them at
const RELAX_PASSES = 4; // times a tick a dead body's links are pulled back to length, each way twice
const ROAR_SECONDS = 3; // one roar at a time

const UP: Vec3 = { x: 0, y: 1, z: 0 };

// A crystal on the underside of a ring segment: on the `link`, `below` metres under its middle,
// `r` metres round. A dragon with any is hurt through them alone, a whole heart a crystal: the
// first shot to reach one from below shatters it, and the ring stays open.
export interface WeakPoint {
  link: number;
  below: number;
  r: number;
}

// What a new one's rising does round it: `ice` metres of frost left on the floor under the pool
// it comes up through, and the `blast` that throws anyone on foot within `reach` metres away at
// `speed` m/s and `lift` m/s up, for `damage` hearts, with `grip` m/s² of air control left to them.
export interface Rising {
  ice: number;
  blast: { reach: number; speed: number; lift: number; damage: number; grip: number };
}

// A dragon skin's body: what the sim moves and shoots at. The client draws the skin's model along
// the same spine, a bone wherever the model needs one (render/avatars/Dragon.ts).
export interface DragonShape {
  // How many times the model's size the dragon is: the links, the radii, the turn and the weak
  // points below are the model's, and `dragonShape` hands out all of them that many times over,
  // as the client draws the model.
  size: number;
  // Metres from the eyes to the first spine point, then from each point to the next: the body's
  // length is their sum, and a point can be no further than its link from the one before it.
  links: readonly number[];
  headRadius: number; // metres: the head's sphere, what walls, undersides and headshots meet
  bodyRadius: number; // metres: the body's, round each spine point
  cruise: number; // m/s flat out
  turnRadius: number; // metres: the tightest arc the head flies
  heartsEvery: number; // spine points between the hearts a dead one leaves, after the one at its head
  weak: readonly WeakPoint[]; // none: shots hurt it anywhere
  rising: Rising | null; // null: it comes up quietly
}

export interface DragonState {
  dir: Vec3; // the way the head is going, a unit vector
  speed: number; // m/s along it
  head: Vec3; // the way the head points, a unit vector: the look, as far round as the neck lets it
  risen: boolean; // the whole spine out of the ground it rose from, and free to fly
  spine: number[]; // x, y, z of each spine point, nearest the head first, each within its link of the last
  shattered: number[]; // the weak points shot out (their indices in the shape's list), in that order
}

// The body a dragon skin has.
export function dragonShape(avatar: AvatarId): DragonShape {
  const grown = GROWN.get(avatar);
  if (grown) return grown;
  const look = AVATARS[avatar];
  if (look.class !== 'asian-dragon') throw new Error(`${avatar} is no dragon`);
  const { size } = look.dragon;
  // To the centimetre, as the spine is kept (follow), so a body at rest lies exactly on its radius.
  const grow = (metres: number) => Math.round(metres * size * 100) / 100;
  const shape: DragonShape = {
    ...look.dragon,
    links: look.dragon.links.map(grow),
    headRadius: grow(look.dragon.headRadius),
    bodyRadius: grow(look.dragon.bodyRadius),
    turnRadius: grow(look.dragon.turnRadius),
    weak: look.dragon.weak.map((w) => ({ ...w, below: grow(w.below), r: grow(w.r) })),
  };
  GROWN.set(avatar, shape);
  return shape;
}

// Each look's shape at its size, made once.
const GROWN = new Map<AvatarId, DragonShape>();

// Metres of body behind the eyes.
export function bodyLength(shape: DragonShape): number {
  return shape.links.reduce((sum, link) => sum + link, 0);
}

// A body straight down from the head, in the ground it rises out of, heading up.
export function createDragon(head: Vec3, shape: DragonShape): DragonState {
  const spine: number[] = [];
  let below = 0;
  for (const link of shape.links) {
    below += link;
    spine.push(head.x, round(head.y - below), head.z);
  }
  return { dir: { ...UP }, speed: 0, head: { ...UP }, risen: false, spine, shattered: [] };
}

export const DRAGON: ClassSpec = {
  id: 'asian-dragon',
  life: { hearts: 40, row: 8, sprite: 'heart' },
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
  confine: (p, shape) => clampToSky(p.pos, shape, dragonShape(p.avatar).headRadius),
  enter(p) {
    p.dragon = createDragon(p.pos, dragonShape(p.avatar));
  },
  exit(p) {
    p.dragon = null;
  },
  step: stepDragon,
  aim: (p: Shooter) => p.dragon?.head ?? lookDirection(p.yaw, p.pitch),
  hitShape,
  hurt,
  lies,
};

// The head against structures: a wall is anything its sphere reaches.
function headBody(y: number, r: number): Body {
  return { head: y + r, reach: y - r, radius: r };
}

// Whether a dragon of `avatar`'s shape can rise where someone's eyes are at `pos`: the sky clear
// from the floor there up to where its head will be once it's free to fly, and nothing round about
// the head on the way up.
function fits(avatar: AvatarId, pos: Vec3, structures: Structures): boolean {
  const shape = dragonShape(avatar);
  const feet = pos.y - EYE_HEIGHT;
  const top = feet + bodyLength(shape);
  if (structures.ceilingAt(pos.x, pos.z, feet) < top + shape.headRadius) return false;
  for (let y = feet + MIN_ALTITUDE; y <= top; y += shape.headRadius)
    if (structures.touches(pos.x, pos.z, headBody(y, shape.headRadius))) return false;
  return true;
}

export function stepDragon(
  p: PlayerState,
  input: InputFrame | null,
  dt: number,
  shape: WorldPart[],
  structures: Structures,
): number {
  const body = dragonShape(p.avatar);
  const d = p.dragon ?? (p.dragon = createDragon(p.pos, body));
  if (p.dead) {
    settle(p, d, body, dt, structures);
    return 0;
  }
  // Nothing moves without a frame: a tick the server runs while a frame is late would carry the
  // head on where the rider's own prediction, which steps once per frame, did not.
  if (!input) return 0;
  if (d.risen) fly(p, d, body, input, dt, shape, structures);
  else emerge(p, d, body, dt, structures);
  return 0;
}

// Out of the ground: the head comes up on its own to MIN_ALTITUDE, then climbs straight on at
// cruise, looking straight up all the while, until the whole spine is out; the keys do nothing.
function emerge(p: PlayerState, d: DragonState, body: DragonShape, dt: number, structures: Structures): void {
  const head = p.pos;
  const ground = structures.groundAt(head.x, head.z, head.y);
  if (head.y < ground + MIN_ALTITUDE) {
    head.y = Math.min(ground + MIN_ALTITUDE, head.y + RISE_SPEED * dt);
    d.speed = 0;
  } else {
    ease(d, body, true, dt);
    head.y = Math.min(structures.ceilingAt(head.x, head.z, head.y) - body.headRadius, head.y + d.speed * dt);
  }
  follow(d.spine, head, body.links);
  d.risen = d.spine[d.spine.length - 2] >= ground;
}

function fly(
  p: PlayerState,
  d: DragonState,
  body: DragonShape,
  input: InputFrame,
  dt: number,
  shape: WorldPart[],
  structures: Structures,
): void {
  const head = p.pos;
  const look = lookDirection(p.yaw, p.pitch);
  // The head comes round toward the look, as far as the neck lets it, moving or not.
  d.head = turnToward(d.head, headTarget(neckOf(d, head), look), HEAD_TURN_RATE * dt);
  ease(d, body, input.my > 0, dt);
  if (d.speed === 0) return;
  const dir = (d.dir = turnToward(d.dir, look, (d.speed / body.turnRadius) * dt));
  const step = d.speed * dt;
  const from = { ...head };
  const r = body.headRadius;
  const ground = groundUnder(head, r, structures);
  // Up or down first, stopped under any underside and MIN_ALTITUDE over whatever is below (a dive
  // stops there; where the ground rises, the head climbs at CLIMB_SPEED); then across, pushed out
  // of walls, and back where it was if that still leaves the head in one (a doorway's jambs, a
  // corner): too big to get through, it stops there.
  head.y += dir.y * step;
  const ceiling = structures.ceilingAt(from.x, from.z, from.y);
  if (head.y + r > ceiling) head.y = ceiling - r;
  const floor = ground + MIN_ALTITUDE;
  if (head.y < floor) head.y = Math.min(floor, Math.max(head.y, from.y) + CLIMB_SPEED * dt);
  structures.move(head, dir.x * step, dir.z * step, headBody(head.y, r));
  clampToSky(head, shape, r);
  if (structures.touches(head.x, head.z, headBody(head.y, r))) {
    head.x = from.x;
    head.y = from.y;
    head.z = from.z;
  }
  follow(d.spine, head, body.links);
}

// The highest ground under any of the head: read at its centre and round its edge, so a merlon or
// a step at the edge lifts the head over itself before the head reaches it.
function groundUnder(head: Vec3, r: number, structures: Structures): number {
  let ground = structures.groundAt(head.x, head.z, head.y);
  for (let i = 0; i < GROUND_SAMPLES; i++) {
    const a = (i / GROUND_SAMPLES) * 2 * Math.PI;
    const x = head.x + Math.cos(a) * r;
    const z = head.z + Math.sin(a) * r;
    ground = Math.max(ground, structures.groundAt(x, z, head.y));
  }
  return ground;
}

// Keeps a head of radius `r` within the world's reach.
function clampToSky(head: Vec3, shape: WorldPart[], r: number): void {
  const reach = worldReach(shape) - r;
  const out = Math.hypot(head.x, head.z);
  if (out > reach) {
    head.x *= reach / out;
    head.z *= reach / out;
  }
}

// Toward cruise while `forward` is held, else to a stop.
function ease(d: DragonState, body: DragonShape, forward: boolean, dt: number): void {
  const want = forward ? body.cruise : 0;
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

// Dead: the head and the body's points sink at SINK_SPEED, each until it rests on whatever is under
// it. A link stretched past its length, where one end sank past an edge the other rests on, pulls
// the hanging end back up, so the body drapes over the edge and hangs where nothing is under it.
function settle(p: PlayerState, d: DragonState, body: DragonShape, dt: number, structures: Structures): void {
  const points: Vec3[] = [p.pos];
  for (let i = 0; i < d.spine.length; i += 3) points.push({ x: d.spine[i], y: d.spine[i + 1], z: d.spine[i + 2] });
  const rests = points.map(
    (q, i) => structures.groundAt(q.x, q.z, q.y) + (i === 0 ? body.headRadius : body.bodyRadius),
  );
  p.vy = 0;
  for (let i = 0; i < points.length; i++) points[i].y = Math.max(rests[i], points[i].y - SINK_SPEED * dt);
  // A stretched link pulls its lower end up toward its upper one (level, they share the pull): a
  // body on a ledge holds against the part hanging over the edge, the part of a hanging body that
  // reached the ground gathers under it, and the neck closes up over the head's deeper rest. A pull
  // stretches the next link along, so the links are gone over from the head and from the tail by
  // turns, which settles a body hanging from either end.
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let n = 1; n < points.length; n++) {
      const i = pass % 2 === 0 ? n : points.length - n;
      const a = points[i - 1];
      const b = points[i];
      const link = body.links[i - 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= link) continue;
      const ka = dy > 0 ? 1 : dy < 0 ? 0 : 0.5;
      const pull = (dist - link) / dist;
      a.x += dx * pull * ka;
      a.y += dy * pull * ka;
      a.z += dz * pull * ka;
      b.x -= dx * pull * (1 - ka);
      b.y -= dy * pull * (1 - ka);
      b.z -= dz * pull * (1 - ka);
    }
  }
  for (let i = 1; i < points.length; i++) {
    d.spine[(i - 1) * 3] = round(points[i].x);
    d.spine[(i - 1) * 3 + 1] = round(points[i].y);
    d.spine[(i - 1) * 3 + 2] = round(points[i].z);
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
// its link behind.
function follow(spine: number[], head: Vec3, links: readonly number[]): void {
  let lx = head.x;
  let ly = head.y;
  let lz = head.z;
  for (let i = 0; i < spine.length; i += 3) {
    const link = links[i / 3];
    const dx = spine[i] - lx;
    const dy = spine[i + 1] - ly;
    const dz = spine[i + 2] - lz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > link) {
      const k = link / dist;
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

// The head, a sphere at every spine point, and a sphere at each weak point still whole.
function hitShape(p: Target): HitShape {
  if (p.dragon && !p.dragon.risen) return { kind: 'spheres', spheres: [] };
  const body = dragonShape(p.avatar);
  const spheres: Sphere[] = [{ x: p.pos.x, y: p.pos.y, z: p.pos.z, r: body.headRadius, head: true }];
  const spine = p.dragon?.spine ?? [];
  for (let i = 0; i < spine.length; i += 3)
    spheres.push({ x: spine[i], y: spine[i + 1], z: spine[i + 2], r: body.bodyRadius, head: false });
  body.weak.forEach((w, n) => {
    if (p.dragon?.shattered.includes(n)) return;
    const at = weakPointAt(p.pos, spine, w);
    if (at) spheres.push({ ...at, r: w.r, head: false, weak: n });
  });
  return { kind: 'spheres', spheres };
}

// Where a weak point is: under the middle of its link, as far below it as straight down goes
// square to the link. A link standing on end has no underside, so none.
export function weakPointAt(head: Vec3, spine: readonly number[], w: WeakPoint): Vec3 | null {
  const a = pointOf(head, spine, w.link - 1);
  const b = pointOf(head, spine, w.link);
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  if (len < 1e-6) return null;
  const f = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
  const down = { x: f.x * f.y, y: f.y * f.y - 1, z: f.z * f.y };
  const flat = Math.hypot(down.x, down.y, down.z);
  if (flat < 0.3) return null;
  return {
    x: (a.x + b.x) / 2 + (down.x / flat) * w.below,
    y: (a.y + b.y) / 2 + (down.y / flat) * w.below,
    z: (a.z + b.z) / 2 + (down.z / flat) * w.below,
  };
}

// Spine point `i`, the head being point -1.
function pointOf(head: Vec3, spine: readonly number[], i: number): Vec3 | null {
  if (i < 0) return head;
  if (i * 3 + 2 >= spine.length) return null;
  return { x: spine[i * 3], y: spine[i * 3 + 1], z: spine[i * 3 + 2] };
}

// A dragon with weak points is hurt through them alone, a whole heart a crystal: the shot that
// reaches one shatters it. Anywhere else, or one already shattered, costs nothing. One without
// them takes the damage as it comes.
function hurt(p: PlayerState, part: HitPart, damage: number): number {
  const shape = dragonShape(p.avatar);
  if (shape.weak.length === 0) return damage;
  if (typeof part !== 'number' || !p.dragon || p.dragon.shattered.includes(part)) return 0;
  p.dragon.shattered.push(part);
  return 1;
}

// Under the head and under every `heartsEvery`-th spine point.
function lies(p: PlayerState, structures: Structures): Vec3[] {
  const every = dragonShape(p.avatar).heartsEvery;
  const under = (x: number, y: number, z: number): Vec3 => ({ x, y: structures.groundAt(x, z, y), z });
  const points = [under(p.pos.x, p.pos.y, p.pos.z)];
  const spine = p.dragon?.spine ?? [];
  for (let i = (every - 1) * 3; i < spine.length; i += every * 3)
    points.push(under(spine[i], spine[i + 1], spine[i + 2]));
  return points;
}
