// Player movement. Runs identically on the server (authoritative) and the client (prediction),
// so it must stay pure: no Babylon, no DOM, no time reads.
import { EYE_HEIGHT, GRAVITY, JUMP_VELOCITY, MAX_PITCH, MOVE_SPEED, PLAYER_PADDING, SPEEDY_MULTIPLIER } from './constants';
import { avatarFor } from './avatars';
import { MAX_HEARTS } from './health';
import { FUEL_REFILL_RATE, ITEMS, createItem, permanentItemFor } from './items';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { WORLD_SHAPE, clampToWorld, type WorldPart } from './world';

export function createPlayer(id: string, name: string, color: string, spawn: Vec3): PlayerState {
  return {
    id,
    name,
    color,
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vy: 0,
    yaw: 0,
    pitch: 0,
    lastSeq: 0,
    reading: null,
    boost: 0,
    item: permanentItem(name),
    scoped: false,
    firing: false,
    avatar: avatarFor(name),
    avatarLeft: null,
    hearts: MAX_HEARTS,
    dead: false,
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, pos: { ...p.pos }, item: p.item && { ...p.item } };
}

function permanentItem(name: string) {
  const id = permanentItemFor(name);
  return id ? createItem(id, true) : null;
}

// Item actions from the frame. Scope is a level the client reports; firing is for hold items
// and needs fuel, which burns while firing and refills at half rate otherwise. Pure, so the
// local fuel gauge and scope state predict exactly. Tap shots are events the Room resolves.
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
    item.fuel = p.firing ? item.fuel - dt : Math.min(spec.fuelSeconds, item.fuel + dt * FUEL_REFILL_RATE);
    if (item.fuel < 1e-9) {
      item.fuel = 0; // the tank ran dry this tick (float slop counts as dry)
      p.firing = false;
    }
  }
}

export function isGrounded(p: PlayerState): boolean {
  return p.pos.y <= EYE_HEIGHT;
}

// Advances one player by `dt`. A null input means "no frame arrived": gravity still applies.
export function stepPlayer(p: PlayerState, input: InputFrame | null, dt: number, shape: WorldPart[] = WORLD_SHAPE): void {
  if (input) {
    p.yaw = input.yaw;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
    p.reading = input.reading;
    p.lastSeq = input.seq;
    if (input.jump && isGrounded(p) && !p.dead) p.vy = JUMP_VELOCITY;
  }

  const speed = MOVE_SPEED * (p.boost > 0 ? SPEEDY_MULTIPLIER : 1);
  p.boost = Math.max(0, p.boost - dt);
  if (p.avatarLeft !== null) {
    p.avatarLeft -= dt;
    if (p.avatarLeft <= 0) {
      p.avatar = 'standard';
      p.avatarLeft = null;
    }
  }
  if (p.item && !p.item.permanent) {
    p.item.left -= dt;
    if (p.item.left <= 0) p.item = null;
  }
  stepItem(p, input, dt);

  p.vy -= GRAVITY * dt;
  p.pos.y += p.vy * dt;
  if (p.pos.y < EYE_HEIGHT) {
    p.pos.y = EYE_HEIGHT;
    p.vy = 0;
  }

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
    p.pos.x += dx * speed * dt;
    p.pos.z += dz * speed * dt;
    clampToWorld(p.pos, PLAYER_PADDING, shape);
  }
}
