// A player on foot: everyone but the dragons. Walks, jumps, falls, lands, climbs steps and ramps,
// slides on ice, and flies on a jetpack, all against the structures; a shot has to land in their
// avatar's capsule. The sim half of the walker class (classes.ts); the look and the held item are
// applied before it runs (player.ts).
import { AVATARS } from './avatars';
import type { ClassSpec } from './classes';
import {
  CHILLED_SPEED_MULTIPLIER,
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
import type { InputFrame, PlayerState } from './types';
import { WORLD_STRUCTURES, clampToWorld, type WorldPart } from './world';

export const WALKER: ClassSpec = {
  id: 'walker',
  hearts: MAX_HEARTS,
  heartRow: 5,
  kit: true,
  bots: true,
  corpseSeconds: null,
  actions: {},
  actionTicks: 0,
  fits: () => true,
  confine: (p, shape) => clampToWorld(p.pos, PLAYER_PADDING, shape),
  enter() {},
  exit() {},
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
  if (input?.jump && grounded && !p.dead && !p.scoped) {
    const takeoff = structures.footing(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT + STEP_UP, PLAYER_RADIUS);
    if (SURFACES[takeoff.surface].grip === Infinity) p.vy = JUMP_VELOCITY;
    else {
      // Ice pushes back only square to itself, so the feet push off it along its normal: straight
      // up on the flat, and on a slope partly downhill, shedding whatever climb the walk had; and
      // with nothing to push against until it lands, that throw is the whole flight.
      const { x: sx, z: sz } = takeoff.slope;
      const len = Math.hypot(sx, 1, sz);
      p.vx -= (JUMP_VELOCITY * sx) / len;
      p.vz -= (JUMP_VELOCITY * sz) / len;
      p.vy = JUMP_VELOCITY / len;
      p.adrift = true;
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
  if (standing) p.adrift = false;

  // Across the floor: where the keys send the walk, at its speed. On a sure footing, and in the
  // air, that's the walk itself; on a slippery one the feet only bend the momentum the walk has,
  // and adrift off ice the walk keeps it, unless a jet's push is something to push against.
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
  else if (!p.adrift || push) {
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
  // The feet's own walk, to a tenth: a slippery footing takes the keys' walk out of their step.
  const pace = grip < Infinity ? Math.hypot(wantX, wantZ) : Math.hypot(p.vx, p.vz);
  p.walk = Math.round(pace * 10) / 10;
  return landing;
}

// One tick of a walk on a slippery footing, where the walk keeps its momentum (vx, vz). Gravity
// pulls it down the slope first; then the feet push it toward where the keys send it, at the
// footing's grip, never faster than the keys ask or than it already goes, or with no keys held,
// slow it at that rate. A slope gravity pulls down harder than the feet can push is a slide, up to
// SLIDE_SPEED.
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
  const want = Math.hypot(wantX, wantZ);
  if (want > 0) {
    vx += (wantX / want) * grip * dt;
    vz += (wantZ / want) * grip * dt;
    const limit = Math.max(want, had);
    const now = Math.hypot(vx, vz);
    if (now > limit) {
      vx *= limit / now;
      vz *= limit / now;
    }
  } else if (had > 0) {
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
