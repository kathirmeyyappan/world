// Player movement. Runs identically on the server (authoritative) and the client (prediction),
// so it must stay pure: no Babylon, no DOM, no time reads.
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_VELOCITY,
  MAX_PITCH,
  MOVE_SPEED,
  PLAYER_PADDING,
  PLAYER_RADIUS,
  SCOPED_SPEED_MULTIPLIER,
  SPEEDY_MULTIPLIER,
  STEP_DOWN,
  STEP_UP,
} from './constants';
import { avatarFor } from './avatars';
import type { Structures } from './collision';
import { CAPSULE_TOP, MAX_HEARTS } from './health';
import { stepGear, thrust } from './gear';
import { ITEMS, createItem, nextFuel, lockedItemFor } from './items';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { WORLD_SHAPE, WORLD_STRUCTURES, clampToWorld, type WorldPart } from './world';

export function createPlayer(id: string, name: string, color: string, spawn: Vec3, bot = false): PlayerState {
  return {
    id,
    name,
    bot,
    color,
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vy: 0,
    yaw: 0,
    pitch: 0,
    lastSeq: 0,
    reading: null,
    boost: 0,
    item: lockedItem(name),
    gear: null,
    scoped: false,
    firing: false,
    thrusting: false,
    avatar: avatarFor(name),
    avatarLocked: avatarFor(name) !== 'standard',
    hearts: MAX_HEARTS,
    kills: 0,
    dead: false,
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, pos: { ...p.pos }, item: p.item && { ...p.item }, gear: p.gear && { ...p.gear } };
}

function lockedItem(name: string) {
  const id = lockedItemFor(name);
  return id ? createItem(id, true) : null;
}

// Weapon actions from the frame. Scope is a level the client reports; firing is for hold items
// and needs fuel, which burns while firing and refills otherwise. Pure, so the local fuel gauge
// and scope state predict exactly. Tap shots are events the Room resolves.
function stepItem(p: PlayerState, input: InputFrame | null, dt: number): void {
  const item = p.item;
  if (!item || p.dead) {
    p.scoped = false;
    p.firing = false;
    return;
  }
  const spec = ITEMS[item.id];
  const held = input ? input.actions : [];
  p.scoped = !!spec.actions.scope && held.includes('scope');
  const wantsFire = spec.actions.shoot?.mode === 'hold' && held.includes('shoot') && (!spec.fireNeedsScope || p.scoped);
  p.firing = wantsFire && (item.fuel === null || item.fuel > 0);
  if (item.fuel !== null && spec.fuelSeconds !== null) {
    item.fuel = nextFuel(item.fuel, spec.fuelSeconds, p.firing, !p.firing, dt);
    if (item.fuel === 0) p.firing = false; // the tank ran dry this tick
  }
}

// Standing on the floor or on a structure's top: eyes no higher than EYE_HEIGHT above it.
export function isGrounded(p: PlayerState, structures: Structures = WORLD_STRUCTURES): boolean {
  return p.pos.y <= structures.groundAt(p.pos.x, p.pos.z, p.pos.y - EYE_HEIGHT + STEP_UP) + EYE_HEIGHT;
}

// Advances one player by `dt`. A null input means "no frame arrived": gravity still applies.
// Returns how fast they were falling if they landed this step (m/s, downward), else 0; the Room
// turns that into fall damage.
export function stepPlayer(
  p: PlayerState,
  input: InputFrame | null,
  dt: number,
  shape: WorldPart[] = WORLD_SHAPE,
  structures: Structures = WORLD_STRUCTURES,
): number {
  if (input) {
    p.yaw = input.yaw;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
    p.reading = input.reading;
    p.lastSeq = input.seq;
  }

  const boosted = p.boost > 0;
  p.boost = Math.max(0, p.boost - dt);
  stepItem(p, input, dt);
  // Scoped (decided by stepItem from this frame) slows the walk and pins them to the ground.
  const speed = MOVE_SPEED * (boosted ? SPEEDY_MULTIPLIER : 1) * (p.scoped ? SCOPED_SPEED_MULTIPLIER : 1);
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
