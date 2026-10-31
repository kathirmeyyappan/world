// A player on foot: everyone but the dragons. Walks, jumps, falls, lands, climbs steps and ramps,
// and flies on a jetpack, all against the structures; a shot has to land in their avatar's capsule.
// The sim half of the walker class (classes.ts); the look and the held item are applied before it
// runs (player.ts).
import { AVATARS } from './avatars';
import type { ClassSpec } from './classes';
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  MOVE_SPEED,
  PLAYER_PADDING,
  PLAYER_RADIUS,
  SCOPED_SPEED_MULTIPLIER,
  SPEEDY_MULTIPLIER,
  STEP_DOWN,
  STEP_UP,
} from './constants';
import type { Structures } from './collision';
import { CAPSULE_TOP, MAX_HEARTS } from './health';
import { stepGear, thrust } from './gear';
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
  enter() {},
  exit() {},
  step: stepWalker,
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
  // Scoped (decided by the item step from this frame) slows the walk and pins them to the ground.
  const speed = MOVE_SPEED * (p.boost > 0 ? SPEEDY_MULTIPLIER : 1) * (p.scoped ? SCOPED_SPEED_MULTIPLIER : 1);
  const grounded = isGrounded(p, structures);
  if (input?.jump && grounded && !p.dead && !p.scoped) p.vy = JUMP_VELOCITY;
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

  if (input && !p.dead && (input.mx !== 0 || input.my !== 0)) {
    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);
    let dx = sinY * input.my + cosY * input.mx;
    let dz = cosY * input.my - sinY * input.mx;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    const feetNow = p.pos.y - EYE_HEIGHT;
    const body = { head: p.pos.y + CAPSULE_TOP, reach: feetNow + STEP_UP, radius: PLAYER_RADIUS };
    structures.move(p.pos, dx * speed * dt, dz * speed * dt, body);
    clampToWorld(p.pos, PLAYER_PADDING, shape);
    // Walking keeps a standing player on the ground: up a step or ramp, down a gentle drop.
    if (standing) {
      const ground = structures.groundAt(p.pos.x, p.pos.z, feetNow + STEP_UP);
      if (ground >= feetNow - STEP_DOWN) p.pos.y = ground + EYE_HEIGHT;
    }
  }
  return landing;
}
