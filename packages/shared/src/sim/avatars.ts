// Avatar types: how a player looks, how big a target they make, and which class (classes.ts) moves
// its wearer; the hit capsule and the eyes follow the body. Its chat command switches for good;
// a name containing an avatar's tag spawns as it and can't switch at all. A bot can also ask for any
// avatar whose class takes bots when it joins (BotPlacement), including one with no command. Adding
// one means a row here, a builder in the client's render/avatars/, and `npm run bot-map` (bots aim
// with these hitboxes).
import type { LifeSpec } from './classes';
import { EYE_HEIGHT } from './constants';
import type { DragonShape } from './dragon';
import type { ItemId } from './items';
import type { Vec3 } from './types';

export type AvatarId =
  | 'standard'
  | 'elizabeth'
  | 'sahur'
  | 'sulley'
  | 'mike'
  | 'spongebob'
  | 'patrick'
  | 'krabs'
  | 'squidward'
  | 'gary'
  | 'light-dragon'
  | 'colgera';

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

interface Look {
  id: AvatarId;
  nameTag: string | null; // a name containing this spawns with the avatar
  blurb: string; // one plain line for the commands menu
  command: string | null; // the chat command that switches a person to it (the menu lists it); null: bots only
  hidden?: boolean; // the menu leaves its command out: a look you have to know about
  // Metres from the feet to its eyes: where its wearer looks from, and where their shots leave. The
  // body everyone moves with has its eyes at EYE_HEIGHT, and `pos` stays that point.
  eye: number;
  hitbox: Hitbox;
  item: ItemId | null; // held for good while it's worn, in place of anything else (a dragon's breath)
  regen: boolean; // hearts back steadily at REGEN_RATE (health.ts)
  life?: LifeSpec; // a life of its own, in place of its class's (classes.ts `lifeOf`)
}

// A look is of a class (classes.ts), and brings what its class's sim needs of it: a dragon its body.
export type AvatarSpec = (Look & { class: 'walker' }) | (Look & { class: 'asian-dragon'; dragon: DragonShape });

// How many times its model's size each dragon is (sim/dragon.ts DragonShape.size).
const LIGHT_DRAGON_SIZE = 1.15;
const COLGERA_SIZE = 1.15;

const LOOKS = {
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
  squidward: {
    id: 'squidward',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'SQUIDWARD',
    blurb: 'become squidward tentacles',
    command: 'squidward',
    eye: 2.74,
    hitbox: { top: 3.2, radius: 0.6, head: 1.25 }, // a 0.95 m head on a 0.75 m shirt, the collar 1.95 m up: the head is everything above it
  },
  gary: {
    id: 'gary',
    class: 'walker',
    item: null,
    regen: false,
    nameTag: 'GARY',
    blurb: 'become gary the snail',
    command: 'gary',
    eye: 0.5, // his eyes, on stalks at the front of his body
    hitbox: { top: 0.65, radius: 0.4, head: 0.2 }, // a 0.63 m snail, 0.75 m from shell to eyes, with the eyes as the head
  },
  'light-dragon': {
    id: 'light-dragon',
    class: 'asian-dragon',
    item: 'firebreath',
    regen: true,
    nameTag: null,
    blurb: 'become the light dragon',
    command: 'light-dragon',
    eye: EYE_HEIGHT, // the head is `pos` itself (sim/dragon.ts)
    // The head's 2 m sphere, all of it head, at the body's size; shots test the body too.
    hitbox: { top: 3.7 * LIGHT_DRAGON_SIZE, radius: 2 * LIGHT_DRAGON_SIZE, head: 3.7 * LIGHT_DRAGON_SIZE },
    dragon: {
      size: LIGHT_DRAGON_SIZE,
      links: Array.from({ length: 20 }, () => 1.875), // 37.5 m of body behind the eyes
      headRadius: 2.5,
      bodyRadius: 1.5,
      // The chin is 1.05 m under the eyes; the body lies on its belly, its legs in the ground.
      underside: { head: 1.05, body: 1.5 },
      cruise: 12.5,
      turnRadius: 10,
      heartsEvery: 5,
      weak: [],
      rising: null,
    },
  },
  // Colgera, the Tears of the Kingdom boss: a segmented ice wyrm (scripts/colgera-model.py, which
  // prints these numbers), its three ring segments each a rigid link of the spine, the thin spine
  // between them telescoped as the game carries it.
  colgera: {
    id: 'colgera',
    class: 'asian-dragon',
    item: 'frostbreath',
    regen: false,
    life: { hearts: 3, row: 3, sprite: 'crystal' }, // a crystal heart per ring segment
    nameTag: null,
    blurb: 'become colgera from tears of the kingdom',
    command: 'colgera',
    eye: EYE_HEIGHT, // the head is `pos` itself (sim/dragon.ts)
    // The head's 2.25 m sphere, all of it head, at the body's size; shots test the body too.
    hitbox: { top: 4.5 * COLGERA_SIZE, radius: 2.25 * COLGERA_SIZE, head: 4.5 * COLGERA_SIZE },
    dragon: {
      size: COLGERA_SIZE,
      links: [
        0.78, 4.26, 0.82, 0.74, 0.68, 0.43, 4.45, 0.74, 0.71, 0.71, 0.71, 0.71, 0.69, 0.71, 0.52, 0.35, 4.35, 0.51,
        0.74, 0.6, 0.63, 0.73,
      ], // 25.6 m of body behind the eyes: the rig's joints, a ring segment 4.3 to 4.5 m long
      headRadius: 2.25,
      bodyRadius: 2, // the spine is 3.7 m across, the rings 6.5 m
      underside: { head: 1.35, body: 0.95 }, // the jaw under the eyes; the rings' undersides, flat things
      cruise: 12.5,
      turnRadius: 14,
      heartsEvery: 5,
      // The crystal in the hollow of each ring's underside: the rings are links 1, 6 and 16.
      weak: [
        { link: 1, below: 0.2, r: 1.6 },
        { link: 6, below: 0.2, r: 1.6 },
        { link: 16, below: 0.2, r: 1.6 },
      ],
      // It comes up through a storm: ice under the pool, and a gale that throws the bystanders.
      rising: { ice: 12, blast: { reach: 20, speed: 9, lift: 5, damage: 2, grip: 6 } },
    },
  },
} satisfies Record<AvatarId, AvatarSpec>;

export const AVATARS: Record<AvatarId, AvatarSpec> = LOOKS;

// The looks of a class: a table over them makes the compiler ask for a new look's row.
export type AvatarsOf<C extends AvatarSpec['class']> = {
  [K in AvatarId]: (typeof LOOKS)[K]['class'] extends C ? K : never;
}[AvatarId];

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

export function isDragonAvatar(id: AvatarId): id is AvatarsOf<'asian-dragon'> {
  return AVATARS[id].class === 'asian-dragon';
}

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
