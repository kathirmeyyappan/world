// What kind of player an avatar makes: how it moves each tick, how much life it has, what shots
// have to land in, and what it can and can't do. Every avatar names its class (avatars.ts), and the
// Room and the client's prediction step a player through it (player.ts), so a new class is a spec
// here with the sim it needs, and a new look in a class is a row in AVATARS.
import { AVATARS, type AvatarId, type Hitbox } from './avatars';
import type { Structures } from './collision';
import type { Shooter, Target } from './combat';
import { DRAGON } from './dragon';
import type { ActionSpec, ItemAction } from './items';
import type { InputFrame, PlayerState, Vec3 } from './types';
import { WALKER } from './walker';
import type { WorldPart } from './world';

export type PlayerClass = 'walker' | 'dragon';

// What a shot tests against (combat.ts): a walker's upright capsule from the feet under its eyes,
// sized by its avatar, or a set of spheres, each a hit wherever it is, a `head` one a headshot.
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
  head: boolean;
}
export type HitShape = { kind: 'capsule'; eye: Vec3; box: Hitbox } | { kind: 'spheres'; spheres: Sphere[] };

export interface ClassSpec {
  id: PlayerClass;
  hearts: number; // a full life
  heartRow: number; // hearts per row on the HUD
  kit: boolean; // may draw weapons, wear gear and take /speedy; false: its look's own item is all it has
  bots: boolean; // whether a bot may wear one of its looks
  // Seconds a dead one lies in the room before its seat goes, whether or not its client stays; null:
  // while the client stays (a browser's death screen, a bot's few seconds).
  corpseSeconds: number | null;
  // Taps a body of this class can do beside its item (a dragon's roars), on keys of their own and
  // reported in InputFrame.actions like an item's. The Room announces each as it's pressed, one at a
  // time: none for `actionTicks` after the last.
  actions: Partial<Record<ItemAction, ActionSpec>>;
  actionTicks: number;
  // Whether a body of this class can be where `pos` (an eye point) is, for a switch into it.
  fits(pos: Vec3, structures: Structures): boolean;
  // Keeps `p` where a body of this class may be: a walker inside the world's outline, a dragon's
  // head within its reach. The class's own step applies it as the body moves; a switch into the
  // class applies it at once, at the same height, so a dragon over the void lands a walker on the
  // nearest edge rather than leaving them falling outside.
  confine(p: PlayerState, shape: WorldPart[]): void;
  // Make and clear the class's own state on `p` as a player switches in and out of it.
  enter(p: PlayerState): void;
  exit(p: PlayerState): void;
  // Moves `p` for one tick of `dt` seconds on `input` (null when no frame arrived), its look and
  // item already applied. Returns how fast it was falling if it landed, m/s downward, else 0.
  step(p: PlayerState, input: InputFrame | null, dt: number, shape: WorldPart[], structures: Structures): number;
  // The way a shot from `p` goes: a walker's look; a dragon's breath leaves the way its head points.
  aim(p: Shooter): Vec3;
  hitShape(p: Target): HitShape;
  // The floor points a dead one's body lies over, one per heart it leaves behind (CORPSE_DROP).
  lies(p: PlayerState, structures: Structures): Vec3[];
}

export const CLASSES: Record<PlayerClass, ClassSpec> = { walker: WALKER, dragon: DRAGON };

export function classOf(avatar: AvatarId): ClassSpec {
  return CLASSES[AVATARS[avatar].class];
}

// A full life for whoever wears `avatar`.
export function heartsOf(avatar: AvatarId): number {
  return classOf(avatar).hearts;
}
