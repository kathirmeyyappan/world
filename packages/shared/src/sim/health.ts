// Hearts and damage. Every player starts with MAX_HEARTS; a weapon takes its `damage` off,
// times HEADSHOT_MULTIPLIER when the shot lands in the head band at the top of the hit
// capsule. Nothing regenerates: you die at zero and rejoin fresh.
import { EYE_HEIGHT } from './constants';
import type { ItemSpec } from './items';

export const MAX_HEARTS = 10;
export const HEADSHOT_MULTIPLIER = 2.5;

// The hit capsule runs from the feet to CAPSULE_TOP above the eyes; the top HEAD_HEIGHT of it
// is the head.
export const CAPSULE_TOP = 0.3;
export const HEAD_HEIGHT = 0.5;

// Whether a hit at this height on a player whose eyes are at `eyeY` is a headshot.
export function isHeadshot(hitY: number, eyeY: number): boolean {
  return hitY >= eyeY + CAPSULE_TOP - HEAD_HEIGHT;
}

export function capsuleFeetY(eyeY: number): number {
  return eyeY - EYE_HEIGHT;
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
