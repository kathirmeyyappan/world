// Avatar types: how a player looks, how big a target they make, and which class (classes.ts) moves
// its wearer; the hit capsule and the eyes follow the body. Its chat command switches for good;
// a name containing an avatar's tag spawns as it and can't switch at all. A bot can also ask for any
// avatar whose class takes bots when it joins (BotPlacement), including one with no command. Adding
// one means a row here, a builder in the client's render/avatars/, and `npm run bot-map` (bots aim
// with these hitboxes).
import type { PlayerClass } from './classes';
import { EYE_HEIGHT } from './constants';
import type { ItemId } from './items';
import type { Vec3 } from './types';

export type AvatarId =
  'standard' | 'elizabeth' | 'sahur' | 'sulley' | 'mike' | 'spongebob' | 'patrick' | 'krabs' | 'light-dragon';

// What shots at a walker test against (sim/combat.ts): a vertical capsule from the feet up to `top`
// metres, `radius` round its axis, whose top `head` metres count as the head. Sized to the drawn
// body, with the radius a little wider than it so a shot that grazes the silhouette still lands.
// Movement ignores it: every walker steps and fits through doors with the same body (sim/walker.ts).
// Another class has its own hit shape; its rows describe it here for the Python bots, which aim with
// these.
export interface Hitbox {
  top: number;
  radius: number;
  head: number;
}

export interface AvatarSpec {
  id: AvatarId;
  nameTag: string | null; // a name containing this spawns with the avatar
  blurb: string; // one plain line for the commands menu
  command: string | null; // the chat command that switches a person to it (the menu lists it); null: bots only
  hidden?: boolean; // the menu leaves its command out: a look you have to know about
  // Metres from the feet to its eyes: where its wearer looks from, and where their shots leave. The
  // body everyone moves with has its eyes at EYE_HEIGHT, and `pos` stays that point.
  eye: number;
  hitbox: Hitbox;
  class: PlayerClass; // what its wearer is (classes.ts)
  item: ItemId | null; // held for good while it's worn, in place of anything else (a dragon's breath)
  regen: boolean; // a heart back every REGEN_SECONDS (health.ts)
}

export const AVATARS: Record<AvatarId, AvatarSpec> = {
  standard: {
    id: 'standard',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: null,
    blurb: 'back to your normal self',
    command: 'standard',
    eye: EYE_HEIGHT,
    hitbox: { top: 2.0, radius: 0.55, head: 0.5 },
  },
  elizabeth: {
    id: 'elizabeth',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'ELIZABETH',
    blurb: 'become elizabeth from gintama',
    command: 'elizabeth',
    eye: 1.62,
    hitbox: { top: 2.0, radius: 0.75, head: 0.55 }, // the egg is 1.24 m across, flippers out past that
  },
  sahur: {
    id: 'sahur',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: null,
    blurb: 'become tung tung tung sahur',
    command: 'tung',
    eye: 2.67,
    hitbox: { top: 3.2, radius: 0.55, head: 0.95 }, // a 0.7 m log; the head is the face, chin up
  },
  sulley: {
    id: 'sulley',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'SULLEY',
    blurb: 'become sulley from monsters, inc.',
    command: 'sulley',
    eye: 2.35,
    hitbox: { top: 2.6, radius: 0.72, head: 0.75 }, // the torso is 1.25 m across; the head sits on the shoulders, chin at 1.6 m
  },
  mike: {
    id: 'mike',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'MIKE',
    blurb: 'become mike wazowski from monsters, inc.',
    command: 'mike',
    eye: 1.08,
    hitbox: { top: 1.4, radius: 0.5, head: 0.5 }, // a 0.9 m ball that is all head: the eye is 1.07 m up
  },
  spongebob: {
    id: 'spongebob',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'SPONGEBOB',
    blurb: 'become spongebob squarepants',
    command: 'spongebob',
    eye: 1.48,
    hitbox: { top: 1.9, radius: 0.55, head: 0.75 }, // a 0.95 m square that is all head: the eyes are 1.5 m up
  },
  patrick: {
    id: 'patrick',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'PATRICK',
    blurb: 'become patrick star',
    command: 'patrick',
    eye: 2.0,
    hitbox: { top: 2.85, radius: 0.7, head: 1.0 }, // a cone that is all head: the eyes are 2 m up
  },
  krabs: {
    id: 'krabs',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'KRABS',
    blurb: 'become mr. krabs',
    command: 'krabs',
    eye: 1.95, // the pupils, near the top of the eyestalks
    hitbox: { top: 2.4, radius: 0.7, head: 1.3 }, // a 1.35 m shell with the face on it, eyestalks on top: the head is everything from the mouth up
  },
  'light-dragon': {
    id: 'light-dragon',
    class: 'dragon',
    item: 'firebreath',
    regen: true,
    nameTag: null,
    blurb: 'become the light dragon',
    command: 'light-dragon',
    hidden: true,
    eye: EYE_HEIGHT, // the head is `pos` itself (sim/dragon.ts)
    hitbox: { top: 3.7, radius: 2, head: 3.7 }, // the head's 2 m sphere, all of it head; shots test the body too
  },
};

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

export function isAvatarId(v: unknown): v is AvatarId {
  return typeof v === 'string' && Object.hasOwn(AVATARS, v);
}

// Where a player's avatar has its eyes, from `pos` (the body's eye point).
export function eyeOf(p: { pos: Vec3; avatar: AvatarId }): Vec3 {
  return { x: p.pos.x, y: p.pos.y + AVATARS[p.avatar].eye - EYE_HEIGHT, z: p.pos.z };
}

// How big an avatar is beside the standard one, by where its eyes are: Mike 0.64, SpongeBob 0.87,
// Patrick 1.18, Tung Tung Tung 1.57. The client scales what makes a wearer feel their size by it
// (how wide they see, how often and how heavily they step, how far their head bobs); the sim does
// not, so a look is never a faster or a harder-to-hit body.
export function statureOf(avatar: AvatarId): number {
  return AVATARS[avatar].eye / EYE_HEIGHT;
}

// The avatar a chat command word ("tung") switches a person to, if any.
export function avatarForCommand(word: string): AvatarId | null {
  return AVATAR_IDS.find((id) => AVATARS[id].command === word) ?? null;
}

// The avatar a name asks for, else the standard one.
export function avatarFor(name: string): AvatarId {
  for (const id of AVATAR_IDS) {
    const tag = AVATARS[id].nameTag;
    if (tag && name.includes(tag)) return id;
  }
  return 'standard';
}
