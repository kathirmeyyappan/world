// Avatar types: how a player looks, and how big a target they make. Movement and items are the
// same for all of them; only the hit capsule and the eyes follow the body. Its chat command switches for good;
// a name containing an avatar's tag spawns as it and can't switch at all. A bot can also ask for any
// avatar when it joins (BotPlacement), including one with no command. Adding one means a row here,
// a builder in the client's render/avatars/, and `npm run bot-map` (bots aim with these hitboxes).
import { EYE_HEIGHT } from './constants';
import type { Vec3 } from './types';

export type AvatarId = 'standard' | 'elizabeth' | 'sahur' | 'sulley' | 'mike' | 'spongebob' | 'patrick';

// What shots test against (sim/combat.ts): a vertical capsule from the feet up to `top` metres,
// `radius` round its axis, whose top `head` metres count as the head. Sized to the drawn body, with
// the radius a little wider than it so a shot that grazes the silhouette still lands. Movement
// ignores it: every avatar walks, steps and fits through doors with the same body (sim/player.ts).
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
  // Metres from the feet to its eyes: where its wearer looks from, and where their shots leave. The
  // body everyone moves with has its eyes at EYE_HEIGHT, and `pos` stays that point.
  eye: number;
  hitbox: Hitbox;
}

export const AVATARS: Record<AvatarId, AvatarSpec> = {
  standard: {
    id: 'standard',
    nameTag: null,
    blurb: 'back to your normal self',
    command: 'standard',
    eye: EYE_HEIGHT,
    hitbox: { top: 2.0, radius: 0.55, head: 0.5 },
  },
  elizabeth: {
    id: 'elizabeth',
    nameTag: 'ELIZABETH',
    blurb: 'become elizabeth from gintama',
    command: 'elizabeth',
    eye: 1.62,
    hitbox: { top: 2.0, radius: 0.75, head: 0.55 }, // the egg is 1.24 m across, flippers out past that
  },
  sahur: {
    id: 'sahur',
    nameTag: null,
    blurb: 'become tung tung tung sahur',
    command: 'tung',
    eye: 2.67,
    hitbox: { top: 3.2, radius: 0.55, head: 0.95 }, // a 0.7 m log; the head is the face, chin up
  },
  sulley: {
    id: 'sulley',
    nameTag: 'SULLEY',
    blurb: 'become sulley from monsters, inc.',
    command: 'sulley',
    eye: 2.35,
    hitbox: { top: 2.6, radius: 0.72, head: 0.75 }, // the torso is 1.25 m across; the head sits on the shoulders, chin at 1.6 m
  },
  mike: {
    id: 'mike',
    nameTag: 'MIKE',
    blurb: 'become mike wazowski from monsters, inc.',
    command: 'mike',
    eye: 1.08,
    hitbox: { top: 1.4, radius: 0.5, head: 0.5 }, // a 0.9 m ball that is all head: the eye is 1.07 m up
  },
  spongebob: {
    id: 'spongebob',
    nameTag: 'SPONGEBOB',
    blurb: 'become spongebob squarepants',
    command: 'spongebob',
    eye: 1.48,
    hitbox: { top: 1.9, radius: 0.55, head: 0.75 }, // a 0.95 m square that is all head: the eyes are 1.5 m up
  },
  patrick: {
    id: 'patrick',
    nameTag: 'PATRICK',
    blurb: 'become patrick star',
    command: 'patrick',
    eye: 2.0,
    hitbox: { top: 2.85, radius: 0.7, head: 1.0 }, // a cone that is all head: the eyes are 2 m up
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
