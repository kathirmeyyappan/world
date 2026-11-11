// A player on foot: everyone but the dragons. Walks, jumps, falls, lands, climbs steps and ramps,
// slides on ice, and flies on a jetpack, all against the structures; a shot has to land in their
// avatar's capsule. The sim half of the walker class (classes.ts); the look and the held item are
// applied before it runs (player.ts).
import { AVATARS } from './avatars';
import type { ClassSpec } from './classes';
import {
  CHILLED_SPEED_MULTIPLIER,
  CLIMB_SPEED,
  EYE_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  MOVE_SPEED,
  PLAYER_PADDING,
  PLAYER_RADIUS,
  SCOPED_SPEED_MULTIPLIER,
  SLIDE_SPEED,
  SPEEDY_MULTIPLIER,
  STEP_DOWN,
  STEP_UP,
} from './constants';
import type { Structures } from './collision';
import { CAPSULE_TOP, MAX_HEARTS } from './health';
import { stepGear, thrust } from './gear';
import { lookDirection } from './look';
import { SURFACES } from './surfaces';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { WORLD_STRUCTURES, clampToWorld, type WorldPart } from './world';

export const WALKER: ClassSpec = {
  id: 'walker',
  life: { hearts: MAX_HEARTS, row: 5, sprite: 'heart' },
  kit: true,
  bots: true,
  corpseSeconds: null,
  actions: {},
  actionTicks: 0,
  fits: () => true,
  confine: (p, shape) => clampToWorld(p.pos, PLAYER_PADDING, shape),
  enter() {},
  exit(p) {
    p.climb = null;
  },
  step: stepWalker,
  aim: (p) => lookDirection(p.yaw, p.pitch),
  hitShape: (p) => ({ kind: 'capsule', eye: p.pos, box: AVATARS[p.avatar].hitbox }),
  // Under the feet.
  lies: (p, structures) => [
    { x: p.pos.x, y: structures.groundAt(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT + 0.01), z: p.pos.z },
  ],
};

// Standing on the floor or on a structure's top: eyes no higher than EYE_HEIGHT above it.
export function isGrounded(p: PlayerState, structures: Structures = WORLD_STRUCTURES): boolean {
  return p.pos.y <= structures.groundAt(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT + STEP_UP) + EYE_HEIGHT;
}

// One tick of walking. A null input means no frame arrived: gravity still applies. Returns how fast
// they were falling if they landed this step (m/s, downward), else 0.
export function stepWalker(
  p: PlayerState,
  input: InputFrame | null,
  dt: number,
  shape: WorldPart[],
  structures: Structures,
): number {
  // Scoped (decided by the item step from this frame) slows the walk and pins them to the ground; an
  // ice hit's chill slows it too.
  const speed =
    MOVE_SPEED *
    (p.boost > 0 ? SPEEDY_MULTIPLIER : 1) *
    (p.scoped ? SCOPED_SPEED_MULTIPLIER : 1) *
    (p.chilled > 0 ? CHILLED_SPEED_MULTIPLIER : 1);
  const grounded = isGrounded(p, structures);
  if (p.climb) return climb(p, input, dt, structures);
  // Holding forward at a ladder's face, on the ground or coming down past it, takes hold of it; and
  // backing onto one from beside its top, holding back, takes hold of its far face, to climb down.
  if (input && input.my !== 0 && !p.dead && p.vy <= 0) {
    const backing = input.my < 0;
    const hold = structures.ladderAt(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT, p.yaw, backing);
    if (hold && takeHold(p, backing ? { ...hold, side: flipped(hold.side) } : hold, structures, !backing))
      return climb(p, input, dt, structures);
  }
  if (input?.jump && grounded && !p.dead && !p.scoped) {
    const takeoff = structures.footing(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT + STEP_UP, PLAYER_RADIUS);
    const grip = SURFACES[takeoff.surface].grip;
    if (grip === Infinity) p.vy = JUMP_VELOCITY;
    else {
      // Ice pushes back only square to itself, so the feet push off it along its normal: straight
      // up on the flat, and on a slope partly downhill, shedding whatever climb the walk had. That
      // is a throw, with the keys left the grip the ice gave them.
      const { x: sx, z: sz } = takeoff.slope;
      const len = Math.hypot(sx, 1, sz);
      throwWalker(p, { x: (-JUMP_VELOCITY * sx) / len, y: JUMP_VELOCITY / len, z: (-JUMP_VELOCITY * sz) / len }, grip);
    }
  }
  const push = stepGear(p, input ? input.actions : [], grounded, dt);

  // Vertical: fall (or brake and rise on the gear's push), stop the head at any underside above it,
  // land on the highest top within a step of where the feet were.
  const feet = p.pos.y - EYE_HEIGHT;
  const ceiling = structures.ceilingAt(p.pos.x, p.pos.z, p.pos.y + CAPSULE_TOP);
  p.vy -= GRAVITY * dt;
  if (push) p.vy = thrust(p.vy, push, dt);
  p.pos.y += p.vy * dt;
  if (p.pos.y + CAPSULE_TOP > ceiling) {
    p.pos.y = ceiling - CAPSULE_TOP;
    p.vy = Math.min(p.vy, 0);
  }
  const floor = structures.groundAt(p.pos.x, p.pos.z, feet + STEP_UP) + EYE_HEIGHT;
  let landing = 0;
  if (p.pos.y < floor) {
    landing = Math.max(0, -p.vy);
    p.pos.y = floor;
    p.vy = 0;
  }
  const standing = p.pos.y <= floor;
  if (standing) p.thrown = null;

  // Across the floor: where the keys send the walk, at its speed. On a sure footing, and in the
  // air on its own feet, that's the walk itself; on a slippery one the feet only bend the momentum
  // the walk has, and thrown they bend the flight at the throw's grip, unless a jet's push is
  // something to push against.
  let wantX = 0;
  let wantZ = 0;
  if (input && !p.dead && (input.mx !== 0 || input.my !== 0)) {
    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);
    wantX = sinY * input.my + cosY * input.mx;
    wantZ = cosY * input.my - sinY * input.mx;
    const len = Math.hypot(wantX, wantZ);
    if (len > 1) {
      wantX /= len;
      wantZ /= len;
    }
    wantX *= speed;
    wantZ *= speed;
  }
  const feetNow = p.pos.y - EYE_HEIGHT;
  const footing = standing ? structures.footing(p.pos.x, p.pos.z, feetNow + STEP_UP, PLAYER_RADIUS) : null;
  const grip = footing ? SURFACES[footing.surface].grip : Infinity;
  if (footing && grip < Infinity) slide(p, wantX, wantZ, grip, footing.slope, dt);
  else if (p.thrown !== null && !push) {
    if (wantX !== 0 || wantZ !== 0) [p.vx, p.vz] = bend(p.vx, p.vz, wantX, wantZ, p.thrown, dt);
  } else {
    p.vx = wantX;
    p.vz = wantZ;
  }

  if (p.vx !== 0 || p.vz !== 0) {
    const fromX = p.pos.x;
    const fromZ = p.pos.z;
    const body = { head: p.pos.y + CAPSULE_TOP, reach: feetNow + STEP_UP, radius: PLAYER_RADIUS };
    structures.move(p.pos, p.vx * dt, p.vz * dt, body);
    clampToWorld(p.pos, PLAYER_PADDING, shape);
    // Walking keeps a standing player on the ground: up a step or ramp, down a gentle drop.
    if (standing) {
      const ground = structures.groundAt(p.pos.x, p.pos.z, feetNow + STEP_UP);
      if (ground >= feetNow - STEP_DOWN) p.pos.y = ground + EYE_HEIGHT;
    }
    // What the walk managed is what it keeps: a wall takes the momentum into it.
    p.vx = (p.pos.x - fromX) / dt;
    p.vz = (p.pos.z - fromZ) / dt;
  }
  // Stepping off ice is a throw as much as a jump off it: the keys get no grip back in the air.
  if (footing && grip < Infinity && !isGrounded(p, structures)) p.thrown = grip;
  // The feet's own walk, to a tenth: a slippery footing takes the keys' walk out of their step.
  const pace = grip < Infinity ? Math.hypot(wantX, wantZ) : Math.hypot(p.vx, p.vz);
  p.walk = Math.round(pace * 10) / 10;
  return landing;
}

// Takes hold of a ladder by the face a walker faces, or by the other face through it where there's
// no room for a body on that one (a rail at a ladder's top): the body comes to stand off the face,
// between the rails, still. False with no room on either, or on that face alone without `eitherFace`.
function takeHold(
  p: PlayerState,
  hold: { piece: number; side: 1 | -1 },
  structures: Structures,
  eitherFace = true,
): boolean {
  const feet = p.pos.y - EYE_HEIGHT;
  for (const side of eitherFace ? [hold.side, flipped(hold.side)] : [hold.side]) {
    const spot = structures.ladderSpot(hold.piece, side, feet);
    if (!structures.fits(spot.x, spot.z, feet, EYE_HEIGHT + CAPSULE_TOP, PLAYER_RADIUS)) continue;
    p.climb = { piece: hold.piece, side, way: 1 };
    p.pos.x = spot.x;
    p.pos.z = spot.z;
    p.vx = p.vz = p.vy = 0;
    p.thrown = null;
    return true;
  }
  return false;
}

function flipped(side: 1 | -1): 1 | -1 {
  return side === 1 ? -1 : 1;
}

// One tick on a ladder: up or down the rungs as the keys say, at CLIMB_SPEED along the rails
// (keeping to them where they lean), as far as the body fits (a face under a floor is climbed only
// up to its underside); over the top onto whatever is beyond the ladder there, holding up; off its
// foot, or onto whatever is under the feet, holding down; straight up and off it on a jump; and
// round to its other face, by its left or its right, on a swap (the client's A and D) where a body
// fits there, its width and all (never through a rail against the ladder, nor under a leaning
// ladder). Nothing pulls the body down, and it stays off the face.
function climb(p: PlayerState, input: InputFrame | null, dt: number, structures: Structures): number {
  const hold = p.climb!;
  const { base, top } = structures.ladderSpan(hold.piece);
  const rise = Math.cos(structures.ladderLean(hold.piece)); // metres up per metre along the rails
  const feet = p.pos.y - EYE_HEIGHT;
  const height = EYE_HEIGHT + CAPSULE_TOP;
  p.vx = p.vz = p.vy = 0;
  p.thrown = null;
  p.thrusting = false;
  if (!input || p.dead) return 0;
  if (input.jump) {
    p.climb = null;
    p.vy = JUMP_VELOCITY;
    return 0;
  }
  const way = input.actions.includes('swap-left') ? -1 : input.actions.includes('swap-right') ? 1 : 0;
  if (way !== 0) {
    const spot = structures.ladderSpot(hold.piece, flipped(hold.side), feet);
    if (structures.fits(spot.x, spot.z, feet, height, PLAYER_RADIUS)) {
      hold.side = flipped(hold.side);
      hold.way = way;
      p.pos.x = spot.x;
      p.pos.z = spot.z;
    }
  }
  const my = Math.max(-1, Math.min(1, input.my));
  let next = feet + my * CLIMB_SPEED * rise * dt;
  if (my > 0 && next >= top) {
    const beyond = structures.ladderSpot(hold.piece, flipped(hold.side), top);
    if (structures.fits(beyond.x, beyond.z, top, height, PLAYER_RADIUS)) {
      p.climb = null;
      p.walk = 0;
      p.pos.x = beyond.x;
      p.pos.z = beyond.z;
      p.pos.y = top + EYE_HEIGHT;
      return 0;
    }
    next = top;
  }
  if (my < 0) {
    const under = structures.ladderSpot(hold.piece, hold.side, next);
    const ground = structures.groundAt(under.x, under.z, next + STEP_UP);
    if (next <= Math.max(base, ground)) {
      next = Math.max(base, ground);
      p.climb = null;
    }
  }
  let at = structures.ladderSpot(hold.piece, hold.side, next);
  if (p.climb && !structures.fits(at.x, at.z, next, height, PLAYER_RADIUS)) {
    next = feet;
    at = { x: p.pos.x, z: p.pos.z };
  }
  // How fast the feet climb the rails, to a tenth: none with the head against a floor.
  p.walk = Math.round((Math.abs(next - feet) / rise / dt) * 10) / 10;
  p.pos.x = at.x;
  p.pos.z = at.z;
  p.pos.y = next + EYE_HEIGHT;
  return 0;
}

// Throws the walk: `dv` joins its velocity, and until it lands the keys have only `grip` (m/s², 0
// for none) to bend the flight with, whatever it took off from. Ice throws a jump off it and
// anything that steps off it; a weapon's knockback or a bounce throws the same way. A throw that
// lifts the walk flies; one that doesn't is at the footing's mercy the next tick.
export function throwWalker(p: PlayerState, dv: Vec3, grip: number): void {
  p.vx += dv.x;
  p.vy += dv.y;
  p.vz += dv.z;
  p.thrown = grip;
}

// One tick of a walk on a slippery footing, where the walk keeps its momentum (vx, vz). Gravity
// pulls it down the slope first; then the feet bend it toward where the keys send it, at the
// footing's grip, or with no keys held, slow it at that rate. A slope gravity pulls down harder
// than the feet can push is a slide, up to SLIDE_SPEED.
function slide(
  p: PlayerState,
  wantX: number,
  wantZ: number,
  grip: number,
  slope: { x: number; z: number },
  dt: number,
): void {
  // Gravity along a surface rising `slope` per metre, in the plane of the floor: g sinθ cosθ downhill.
  const steep = 1 + slope.x * slope.x + slope.z * slope.z;
  let vx = p.vx - ((GRAVITY * slope.x) / steep) * dt;
  let vz = p.vz - ((GRAVITY * slope.z) / steep) * dt;
  const had = Math.hypot(vx, vz);
  if (wantX !== 0 || wantZ !== 0) [vx, vz] = bend(vx, vz, wantX, wantZ, grip, dt);
  else if (had > 0) {
    const left = Math.max(0, had - grip * dt) / had;
    vx *= left;
    vz *= left;
  }
  const v = Math.hypot(vx, vz);
  if (v > SLIDE_SPEED) {
    vx *= SLIDE_SPEED / v;
    vz *= SLIDE_SPEED / v;
  }
  p.vx = vx;
  p.vz = vz;
}

// A velocity bent toward where the keys send it (wantX, wantZ, not both 0) by one tick of the feet
// pushing at `grip`, never faster than the keys ask or than it already goes.
function bend(vx: number, vz: number, wantX: number, wantZ: number, grip: number, dt: number): [number, number] {
  const want = Math.hypot(wantX, wantZ);
  const limit = Math.max(want, Math.hypot(vx, vz));
  vx += (wantX / want) * grip * dt;
  vz += (wantZ / want) * grip * dt;
  const now = Math.hypot(vx, vz);
  return now > limit ? [(vx * limit) / now, (vz * limit) / now] : [vx, vz];
}
