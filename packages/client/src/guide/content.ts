// The guide's words: what each character, item, place and bot is, and a few fun facts. No numbers
// live here: anything the game decides (speeds, damage, heights, counts) is read off the code in
// stats.ts, so this file only goes stale if what a thing *is* changes. The tables are keyed by the
// registries' ids, so a new skin or item doesn't build until it has an entry.
import type { AvatarId, BotId, GearId, ItemId, PickupKind } from '@world/shared';

export interface Entry {
  title: string;
  from?: string; // where the character comes from
  summary: string;
  facts: string[];
}

export const INTRO = [
  "There's no real goal here. Hop on with friends and do whatever: fight each other, explore, take on the bots, or just hang out.",
  'Everything below is read straight off the game, so the numbers are always the ones it plays by.',
];

// The keys every body on foot uses; a dragon flies forward on W and roars on A, S and D.
export const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Space', 'jump'],
  ['Mouse', 'look; click to shoot, open a door or read a cube'],
  ['Z', 'first or third person'],
  ['C', 'every command as a button'],
  ['Enter', 'chat, or a /command'],
  ['X / Esc', 'menu'],
  ['P', 'map: near or the whole world'],
];

export const CHARACTERS: Record<AvatarId, Entry> = {
  standard: {
    title: 'Standard',
    summary: 'The body everyone starts in: a blocky figure with a glowing visor, painted in your colour.',
    facts: ['/[color] repaints it in any of the named colours, like /red or /purple.'],
  },
  elizabeth: {
    title: 'Elizabeth',
    from: 'Gintama',
    summary: 'A big white egg of a body with a flat orange beak, two flippers and webbed feet.',
    facts: [
      'She waddles, rocking side to side and lifting alternate feet.',
      'Whatever she holds goes in her right flipper.',
    ],
  },
  sahur: {
    title: 'Tung Tung Tung Sahur',
    from: 'Italian brainrot',
    summary: 'A wooden log with a face and a bat, staring wall-eyed.',
    facts: [
      'Three of them stand guard on the tower’s lower floors in every room, as stalker bots.',
      'Its head twitches now and then; anything it holds takes the bat’s place.',
    ],
  },
  sulley: {
    title: 'Sulley',
    from: 'Monsters, Inc.',
    summary: 'Teal fur with purple spots. He lumbers, long arms swinging against short legs.',
    facts: ['His tail sways on its own, and he dies flat on his back with it out to one side.'],
  },
  mike: {
    title: 'Mike Wazowski',
    from: 'Monsters, Inc.',
    summary: 'A green ball with one eye on two short legs.',
    facts: ['The ball is head and body in one, so his whole body tips with your look.', '/wazowski works too.'],
  },
  spongebob: {
    title: 'SpongeBob SquarePants',
    from: 'SpongeBob SquarePants',
    summary: 'A yellow sponge in square pants on thin legs.',
    facts: [
      'His footsteps squeak, high and low.',
      'His pineapple is Building 1, with the rooms from Battle for Bikini Bottom inside.',
    ],
  },
  patrick: {
    title: 'Patrick Star',
    from: 'SpongeBob SquarePants',
    summary: 'A pink starfish in flowered shorts, ported from his Fortnite model.',
    facts: ['One and a half SpongeBobs tall, as on the show.'],
  },
  krabs: {
    title: 'Mr. Krabs',
    from: 'SpongeBob SquarePants',
    summary: 'A red crab in a blue shirt, his eyes on stalks a head above his shell.',
    facts: ['He scuttles: tiny quick steps under one looping sound.'],
  },
  squidward: {
    title: 'Squidward Tentacles',
    from: 'SpongeBob SquarePants',
    summary: 'A tall, unhurried squid in a brown shirt, on four tentacles.',
    facts: ['Each side’s two tentacles plop down together: a lighter plop, then a heavier one.'],
  },
  gary: {
    title: 'Gary the Snail',
    from: 'SpongeBob SquarePants',
    summary: 'SpongeBob’s snail: a soft body, a shell on his back, and eyes on stalks.',
    facts: [
      'No arms: whatever he holds floats beside his eyes.',
      'No footsteps either, just a faint slime slide.',
      'He dies rolled onto his side.',
    ],
  },
  plankton: {
    title: 'Plankton',
    from: 'SpongeBob SquarePants',
    summary: 'The smallest thing in the world: one eye, two antennae, and big plans.',
    facts: ['His model comes from Battle for Bikini Bottom: Rehydrated.'],
  },
  'light-dragon': {
    title: 'Light Dragon',
    from: 'The Legend of Zelda: Tears of the Kingdom',
    summary: 'A long golden dragon that flies where you look and breathes fire. W flies, A, S and D roar.',
    facts: [
      'It rises out of the ground through a portal of gold light.',
      'While one is alive, everyone near it hears its theme.',
    ],
  },
  colgera: {
    title: 'Colgera',
    from: 'The Legend of Zelda: Tears of the Kingdom',
    summary: 'The ice boss: three ringed segments on a stiff spine, with wings, breathing frost.',
    facts: [
      'Each ring’s crystal is a heart: shoot them from below, and a spray only washes over them.',
      'It rises in a storm that freezes the ground and throws everyone nearby.',
    ],
  },
};

export const ITEM_TEXT: Record<ItemId, Entry> = {
  gun: {
    title: 'Handgun',
    summary: 'The all-rounder: point, click, repeat.',
    facts: ['Shots pass through the floating info cubes; only buildings stop them.'],
  },
  sniper: {
    title: 'Sniper rifle',
    summary: 'Long range and heavy hits, but only through the scope.',
    facts: ['Shots are judged where your target was on your screen, so aim at what you see.'],
  },
  flamethrower: {
    title: 'Flamethrower',
    summary: 'Hold to spray a cone of fire that burns everyone in it.',
    facts: ['Let go and the tank refills on its own.'],
  },
  'ice-blower': {
    title: 'Ice blower',
    summary: 'Hold to spray a cone of frost: slows whoever it touches and ices the ground.',
    facts: [
      'Frost never thaws on its own; only fire melts it.',
      'A level spray lays a long tongue of ice along the floor, and ice is slippery.',
    ],
  },
  firebreath: {
    title: 'Fire breath',
    summary: 'The light dragon’s own: a wide cone of fire from its mouth.',
    facts: [],
  },
  frostbreath: {
    title: 'Frost breath',
    summary: 'Colgera’s own: a wide cone of frost from its mouth.',
    facts: [],
  },
};

export const GEAR_TEXT: Record<GearId, Entry> = {
  jetpack: {
    title: 'Jetpack',
    summary: 'Worn on your back next to whatever you hold. Jump, then keep holding to fly.',
    facts: ['It brakes a fall hard, so it can save you from fall damage.'],
  },
};

export const PICKUP_TEXT: Record<PickupKind, Entry> = {
  heart: {
    title: 'Heart',
    summary: 'Floats about the world. Walk into one below full health to take it.',
    facts: [],
  },
  'big-heart': {
    title: 'Big heart',
    summary: 'Twice the size, and back to full.',
    facts: [],
  },
};

export const SPEEDY: Entry = {
  title: 'Speed boost',
  summary: 'Run faster for a while.',
  facts: [],
};

// A photo of a place, from public/assets/guide/places/ (`<file>.jpg`, and `<file>-thumb.jpg` for
// the gallery), taken in the game.
export interface Photo {
  file: string;
  caption: string;
}

export interface Place extends Entry {
  id: 'main' | 'pineapple' | 'buildings' | 'tower' | 'terrace';
  photos: Photo[];
}

export const PLACES: Place[] = [
  {
    id: 'main',
    title: 'Main area',
    summary: 'Where everyone spawns. The floating cubes tell Kathir’s work history: click one to read it.',
    facts: ['The cubes were the whole of Kathir World before everything else arrived.'],
    photos: [
      { file: 'main-cubes', caption: 'The info cubes over the main area' },
      { file: 'main-wide', caption: 'Across the main area toward the tower' },
    ],
  },
  {
    id: 'pineapple',
    title: 'SpongeBob’s pineapple',
    summary:
      'Building 1, on a dune of sand. Click its door to go in: the rooms from Battle for Bikini Bottom, from the living room up to the bedroom and the library on top, and a deck on the crown.',
    facts: ['The library has a slide down from a hatch high in the wall, and it’s icy.'],
    photos: [
      { file: 'pineapple-outside', caption: 'SpongeBob’s pineapple, on its dune' },
      { file: 'pineapple-dune', caption: 'The pineapple from its dune' },
      { file: 'pineapple-living-room', caption: 'The living room' },
      { file: 'pineapple-living-room-2', caption: 'The living room from by the side door' },
      { file: 'pineapple-living-room-3', caption: 'The living room from near the front door' },
      { file: 'pineapple-library', caption: 'The library at the top, and its ladder' },
      { file: 'pineapple-plan-ground-floor', caption: 'Floor plan: the ground floor' },
      { file: 'pineapple-plan-first-floor', caption: 'Floor plan: the first floor, round the bedroom' },
      { file: 'pineapple-plan-library', caption: 'Floor plan: the library' },
    ],
  },
  {
    id: 'buildings',
    title: 'Buildings 2 to 4',
    summary:
      'Round keeps on the other sides of the main area. Buildings 2 and 3 are the tower’s ground and first floors standing alone, murals and all; Building 4 is a bare keep, for now.',
    facts: [],
    photos: [
      { file: 'keep-outside', caption: 'Building 2' },
      { file: 'keep-inside', caption: 'Inside Building 3' },
    ],
  },
  {
    id: 'tower',
    title: 'Tung Tung Tower',
    summary:
      'A round tower of four floors, each one a building’s floor, stair and murals alike. A bridge runs from its top to the terrace.',
    facts: ['A good sniper’s nest: the sniper bot starts out inside it.'],
    photos: [
      { file: 'tower-outside', caption: 'Tung Tung Tower from the bridge' },
      { file: 'tower-inside', caption: 'The ground floor, its stair winding up the wall' },
      { file: 'tower-bridge', caption: 'The sky bridge from the tower’s top to the terrace' },
    ],
  },
  {
    id: 'terrace',
    title: 'Terrace',
    summary:
      'A huge brick ring high over the main area, reached by a staircase from each building’s roof and the tower’s sky bridge.',
    facts: ['A jetpack gets you up there faster.'],
    photos: [
      { file: 'terrace-overview', caption: 'The terrace over the main area, with its staircases' },
      { file: 'terrace-deck', caption: 'On the deck' },
    ],
  },
];

export const BOT_TEXT: Record<BotId, { summary: string }> = {
  circle: { summary: 'Circles the nearest player, going round anything in its way.' },
  stalker: { summary: 'Stands still and turns to watch the nearest person.' },
  sniper: {
    summary: 'Starts inside the tower, climbs to a lookout and snipes. Moves when it has no shot or gets hit.',
  },
};

export const BOT_NOTE = 'Bots run on Modal and don’t come back after they die.';

export const BOT_EXAMPLES: [string, string][] = [
  ['/circle-bot --skin tung', 'a circle bot that looks like Tung Tung Tung Sahur, for the default time'],
  [
    '/sniper-bot -t 500 -n snipah -s elizabeth --target circ',
    'a sniper bot called snipah, as Elizabeth, for 500 seconds, hunting anyone with “circ” in their name',
  ],
];
