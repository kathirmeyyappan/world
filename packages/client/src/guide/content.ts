// The guide's words: what each character, item, place and bot is, said plainly. No numbers live
// here: anything the game decides (speeds, damage, heights, counts) is read off the code in
// stats.ts. The tables are keyed by the registries' ids, so a new skin or item doesn't build until
// it has an entry. `facts` are shown under a thing's numbers when there are any.
import type { AvatarId, GearId, ItemId, PickupKind } from '@world/shared';

export interface Entry {
  title: string;
  summary: string;
  facts: string[];
}

export const INTRO = [
  'There’s no real goal here. Hop online with your friends and do random stuff. You can kill each other, explore, fight bots, or just hang out.',
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

const plain = (title: string, summary: string): Entry => ({ title, summary, facts: [] });

export const CHARACTERS: Record<AvatarId, Entry> = {
  standard: plain('Standard', 'The default skin.'),
  elizabeth: plain('Elizabeth', 'Elizabeth from Gintama.'),
  sahur: plain('Tung Tung Tung Sahur', 'Tung Tung Tung Sahur.'),
  sulley: plain('Sulley', 'Sulley from Monsters, Inc.'),
  mike: plain('Mike Wazowski', 'Mike Wazowski from Monsters, Inc.'),
  spongebob: plain('SpongeBob SquarePants', 'SpongeBob SquarePants.'),
  patrick: plain('Patrick Star', 'Patrick Star from SpongeBob SquarePants.'),
  krabs: plain('Eugene Krabs', 'Eugene Krabs from SpongeBob SquarePants.'),
  squidward: plain('Squidward Tentacles', 'Squidward Tentacles from SpongeBob SquarePants.'),
  gary: plain('Gary', 'SpongeBob’s pet snail.'),
  plankton: plain('Plankton', 'Plankton from SpongeBob SquarePants.'),
  'light-dragon': plain(
    'Light Dragon',
    'The Light Dragon from Tears of the Kingdom. A dragon flies, with its own controls.',
  ),
  colgera: plain('Colgera', 'Colgera from Tears of the Kingdom. A dragon flies, with its own controls.'),
};

export const ITEM_TEXT: Record<ItemId, Entry> = {
  gun: plain('Handgun', 'A handgun.'),
  sniper: plain('Sniper rifle', 'A sniper rifle.'),
  flamethrower: plain('Flamethrower', 'A flamethrower.'),
  'ice-blower': plain('Ice blower', 'An ice blower.'),
  firebreath: plain('Fire breath', 'The Light Dragon’s fire breath.'),
  frostbreath: plain('Frost breath', 'Colgera’s frost breath.'),
};

export const GEAR_TEXT: Record<GearId, Entry> = {
  jetpack: plain('Jetpack', 'A jetpack.'),
};

export const PICKUP_TEXT: Record<PickupKind, Entry> = {
  heart: plain('Heart', 'A heart.'),
  'big-heart': plain('Big heart', 'A big heart.'),
};

export const SPEEDY: Entry = plain('Speed boost', 'A speed boost.');

export const RESUME_CUBE: Entry = plain(
  'Resume cube',
  'Clickable pieces of my resume. Fun fact: these used to be the only things in kathir world back in the day.',
);

export interface Photo {
  file: string;
  caption: string;
}

export interface Place extends Entry {
  id: 'main' | 'pineapple' | 'welcome' | 'sanctuary' | 'building4' | 'tower' | 'terrace';
  building?: number; // a building's place, by its number less one: its title is the game's name for it (BUILDING_NAMES)
  photos: Photo[];
}

export const PLACES: Place[] = [
  {
    id: 'main',
    title: 'Main area',
    summary: 'Where all non-bot players spawn. Contains floating cubes that list Kathir’s job experiences.',
    facts: [],
    photos: [
      { file: 'main-cubes', caption: 'The info cubes over the main area' },
      { file: 'main-wide', caption: 'Across the main area toward the tower' },
    ],
  },
  {
    id: 'pineapple',
    title: 'SpongeBob’s house',
    summary: 'Building 1: SpongeBob’s pineapple house, with rooms inside.',
    facts: [],
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
    id: 'welcome',
    building: 1,
    title: '',
    summary: 'Building 2. A copy of the tower’s ground floor.',
    facts: [],
    photos: [
      { file: 'welcome-room-outside', caption: 'Outside' },
      { file: 'welcome-room-spotify', caption: 'The Spotify widget' },
      { file: 'welcome-room-photos', caption: 'Inside' },
    ],
  },
  {
    id: 'sanctuary',
    building: 2,
    title: '',
    summary: 'Building 3. A copy of the tower’s first floor.',
    facts: [],
    photos: [
      { file: 'dire-sanctuary-outside', caption: 'Outside' },
      { file: 'dire-sanctuary-anime', caption: 'The anime list' },
      { file: 'dire-sanctuary-covers', caption: 'Inside' },
    ],
  },
  {
    id: 'building4',
    building: 3,
    title: '',
    summary: 'Empty for now.',
    facts: [],
    photos: [
      { file: 'building-4-outside', caption: 'Outside' },
      { file: 'building-4-inside', caption: 'Inside' },
    ],
  },
  {
    id: 'tower',
    title: 'Tung Tung Tower',
    summary:
      'A four-floor tower. The Welcome Room and the Dire Sanctuary are copies of its ground and first floors. A bridge on top connects it to the terrace.',
    facts: [],
    photos: [
      { file: 'tower-outside', caption: 'Tung Tung Tower from the bridge' },
      { file: 'tower-inside', caption: 'The ground floor' },
      { file: 'tower-bridge', caption: 'The sky bridge from the tower’s top to the terrace' },
    ],
  },
  {
    id: 'terrace',
    title: 'Terrace',
    summary:
      'A brick terrace above the main area, reached by staircases from the roofs of the Welcome Room, the Dire Sanctuary and Building 4, and by the bridge from the tower.',
    facts: [],
    photos: [
      { file: 'terrace-overview', caption: 'The terrace over the main area, with its staircases' },
      { file: 'terrace-deck', caption: 'On the deck' },
    ],
  },
];

export const BOT_NOTE = 'Bots run using Modal functions, and will not respawn after they die.';

export const BOT_EXAMPLES: [string, string][] = [
  [
    '/sniper-bot -t 500 -n snipah -s elizabeth --target circ',
    'spawns a sniper bot named snipah for 500s with the Elizabeth avatar, targeting players with “circ” in their username.',
  ],
  [
    '/circle-bot --skin tung',
    'spawns a circle bot named circle-bot with the Tung Tung Tung Sahur skin, for the default time.',
  ],
];
