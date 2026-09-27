// Player movement. Runs identically on the server (authoritative) and the client (prediction),
// so it must stay pure: no Babylon, no DOM, no time reads.
import { EYE_HEIGHT, GRAVITY, JUMP_VELOCITY, MAX_PITCH, MOVE_SPEED, PLAYER_PADDING, SPEEDY_MULTIPLIER } from './constants';
import { avatarFor } from './avatars';
import { permanentItemFor } from './items';
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
    avatar: avatarFor(name),
    avatarLeft: null,
    dead: false,
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, pos: { ...p.pos }, item: p.item && { ...p.item } };
}

function permanentItem(name: string) {
  const id = permanentItemFor(name);
  return id ? { id, left: 0, permanent: true } : null;
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
