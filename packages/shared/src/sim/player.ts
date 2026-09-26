// Player movement. Runs identically on the server (authoritative) and the client (prediction),
// so it must stay pure: no Babylon, no DOM, no time reads.
import { EYE_HEIGHT, GRAVITY, JUMP_VELOCITY, MAX_PITCH, MOVE_SPEED, PLAYER_PADDING } from './constants';
import type { InputFrame, PlayerState, Vec3 } from './types';

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
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p, pos: { ...p.pos } };
}

export function isGrounded(p: PlayerState): boolean {
  return p.pos.y <= EYE_HEIGHT;
}

// Advances one player by `dt`. A null input means "no frame arrived": gravity still applies.
export function stepPlayer(p: PlayerState, input: InputFrame | null, dt: number, worldRadius: number): void {
  if (input) {
    p.yaw = input.yaw;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, input.pitch));
    p.reading = input.reading;
    p.lastSeq = input.seq;
    if (input.jump && isGrounded(p)) p.vy = JUMP_VELOCITY;
  }

  p.vy -= GRAVITY * dt;
  p.pos.y += p.vy * dt;
  if (p.pos.y < EYE_HEIGHT) {
    p.pos.y = EYE_HEIGHT;
    p.vy = 0;
  }

  if (input && (input.mx !== 0 || input.my !== 0)) {
    const sinY = Math.sin(p.yaw);
    const cosY = Math.cos(p.yaw);
    let dx = sinY * input.my + cosY * input.mx;
    let dz = cosY * input.my - sinY * input.mx;
    const len = Math.hypot(dx, dz);
    if (len > 1) {
      dx /= len;
      dz /= len;
    }
    p.pos.x += dx * MOVE_SPEED * dt;
    p.pos.z += dz * MOVE_SPEED * dt;
    clampToWorld(p.pos, worldRadius - PLAYER_PADDING);
  }
}

export function clampToWorld(pos: Vec3, maxRadius: number): void {
  const d = Math.hypot(pos.x, pos.z);
  if (d > maxRadius) {
    const s = maxRadius / d;
    pos.x *= s;
    pos.z *= s;
  }
}
