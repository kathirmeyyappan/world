// Hearts and damage. Every player starts with MAX_HEARTS; a weapon takes its `damage` off,
// times HEADSHOT_MULTIPLIER when the shot lands in the head band at the top of the hit
// capsule, and a hard landing takes fallDamage. Nothing regenerates: you die at zero and rejoin fresh.
import type { Hitbox } from './avatars';
import { EYE_HEIGHT, GRAVITY, TICK_DT } from './constants';
import type { ItemSpec } from './items';

export const MAX_HEARTS = 10;
export const HEADSHOT_MULTIPLIER = 2.5;

// Headroom above the eyes: the top of the body that walks, for ceilings and doorways.
export const CAPSULE_TOP = 0.3;

// Whether a hit at this height on a player whose eyes are at `eyeY` is a headshot: it lands in the
// head band at the top of their hitbox.
export function isHeadshot(hitY: number, eyeY: number, hitbox: Hitbox): boolean {
  return hitY >= capsuleFeetY(eyeY) + hitbox.top - hitbox.head;
}

export function capsuleFeetY(eyeY: number): number {
  return eyeY - EYE_HEIGHT;
}

// Falls hurt by how fast you land, measured against a plain drop from rest: landing slower than a
// FALL_SAFE_DROP-metre drop is free, as fast as a FALL_DEADLY_DROP-metre drop takes every heart, and
// in between the damage rises linearly with speed, rounded down to FALL_DAMAGE_STEP. Anything that
// slows the landing (a jetpack braking the fall) saves you the difference.
export const FALL_SAFE_DROP = 15;
export const FALL_DEADLY_DROP = 80;
export const FALL_DAMAGE_STEP = 0.5;

// The speed, m/s, of landing after falling `metres` from rest in the sim, whose ticks add a tick of
// gravity before moving: a drop of v(v + g·dt)/2g, so a real 80 m drop lands at least this fast.
export function dropSpeed(metres: number): number {
  const g = GRAVITY * TICK_DT;
  return (-g + Math.sqrt(g * g + 8 * GRAVITY * metres)) / 2;
}

const SAFE_SPEED = dropSpeed(FALL_SAFE_DROP);
const DEADLY_SPEED = dropSpeed(FALL_DEADLY_DROP);

// Hearts a landing at `speed` m/s (downward) takes.
export function fallDamage(speed: number): number {
  if (speed <= SAFE_SPEED) return 0;
  const hearts = (MAX_HEARTS * (speed - SAFE_SPEED)) / (DEADLY_SPEED - SAFE_SPEED);
  return Math.min(MAX_HEARTS, Math.floor(hearts / FALL_DAMAGE_STEP) * FALL_DAMAGE_STEP);
}

export function damageFor(spec: Pick<ItemSpec, 'damage'>, headshot: boolean): number {
  return headshot ? spec.damage * HEADSHOT_MULTIPLIER : spec.damage;
}

// Takes `damage` hearts off, never below zero. Returns whether that killed them.
export function applyDamage(p: { hearts: number; dead: boolean }, damage: number): boolean {
  if (p.dead) return false;
  p.hearts = Math.max(0, p.hearts - damage);
  p.dead = p.hearts === 0;
  return p.dead;
}
