// The guide's words: what each character, item, place and bot is, said plainly. No numbers live
// here: anything the game decides (speeds, damage, heights, counts) is read off the code in
// stats.ts. The tables are keyed by the registries' ids, so a new skin or item doesn't build until
// it has an entry. `facts` are shown under a thing's numbers when there are any.
import type { AvatarId, BotFlag, BotId, GearId, ItemId, PickupKind } from '@world/shared';

export interface Entry {
  title: string;
  summary: string;
  facts: string[];
}

export const INTRO = [
  'This is by no means exhaustive, but hopefully it sheds light on the full potential of kathir world.',
];

// The keys, on foot and as a dragon.
const SHARED: [string, string][] = [
  ['Z', 'first or third person'],
  ['C', 'every command as a button'],
  ['Enter', 'chat, or a /command'],
  ['X / Esc', 'menu'],
  ['P', 'map: near or the whole world'],
];
export const CONTROLS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Standard',
    keys: [
      ['WASD', 'move'],
      ['Space', 'jump'],
      ['Mouse', 'look; click to shoot, open a door or read a cube'],
      ...SHARED,
    ],
  },
  {
    title: 'Dragon',
    keys: [['W', 'fly forward'], ['Mouse', 'steer; hold click to breathe'], ['A / S / D', 'roar'], ...SHARED],
  },
];

const plain = (title: string, summary: string): Entry => ({ title, summary, facts: [] });

export const CHARACTERS: Record<AvatarId, Entry> = {
  standard: plain('Standard', 'The default skin.'),
  elizabeth: plain('Elizabeth', 'Elizabeth from Gintama.'),
  sahur: plain('Tung Tung Tung Sahur', 'Tung Tung Tung Sahur.'),
  sulley: plain('Sulley', 'Sulley from Monsters, Inc.'),
  mike: plain('Mike Wazowski', 'Mike Wazowski from Monsters, Inc.'),
  spongebob: plain('SpongeBob SquarePants', 'The one and only SpongeBob SquarePants.'),
  patrick: plain('Patrick Star', 'SpongeBob’s best friend. Is mayonnaise an instrument?'),
  krabs: plain('Eugene Krabs', 'Standing at the concession. Plotting our oppression.'),
  squidward: plain('Squidward Tentacles', 'SpongeBob’s grumpy ahh neighbor.'),
  gary: plain('Gary', 'SpongeBob’s pet snail.'),
  plankton: plain('Plankton', 'Mr. Krabs’ arch nemesis and the smallest character in this game.'),
  'light-dragon': plain('Light Dragon', 'The Light Dragon from Tears of the Kingdom.'),
  colgera: plain(
    'Colgera',
    'The Wind Temple boss from Tears of the Kingdom. Its weak points are the 3 circular crystals on its underbelly.',
  ),
};

export const ITEM_TEXT: Record<ItemId, Entry> = {
  gun: plain('Handgun', 'A handgun.'),
  sniper: plain('Sniper rifle', 'A sniper rifle.'),
  flamethrower: plain('Flamethrower', 'A flamethrower.'),
  'ice-blower': plain('Ice blower', 'An ice blower.'),
  firebreath: plain('Fire breath', ''),
  frostbreath: plain('Frost breath', ''),
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
    summary:
      'Where all non-bot players spawn. This is home to the resume cubes and is the entirety of what kathir world once was.',
    facts: [],
    photos: [
      { file: 'main-cubes', caption: 'The info cubes over the main area' },
      { file: 'main-wide', caption: 'Across the main area toward the tower' },
    ],
  },
  {
    id: 'pineapple',
    title: 'SpongeBob’s house',
    summary: 'SpongeBob’s house in as much of its glory as I could build.',
    facts: [],
    photos: [
      { file: 'pineapple-far', caption: 'SpongeBob’s pineapple, on its dune' },
      { file: 'pineapple-aerial', caption: 'From above' },
      { file: 'pineapple-living-room', caption: 'The living room' },
      { file: 'pineapple-living-room-2', caption: 'The living room from by the side door' },
      { file: 'pineapple-living-room-3', caption: 'The living room from near the front door' },
      { file: 'pineapple-bedroom', caption: 'The bedroom' },
      { file: 'pineapple-plan-ground-floor', caption: 'Floor plan: the ground floor' },
      { file: 'pineapple-plan-first-floor', caption: 'Floor plan: the first floor, round the bedroom' },
      { file: 'pineapple-plan-library', caption: 'Floor plan: the library' },
    ],
  },
  {
    id: 'welcome',
    building: 1,
    title: '',
    summary: 'A room with some info about me and a live Spotify widget.',
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
    summary: 'A room with some peak anime as well as a live tracker of my recently watched / read media.',
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
      'Tung Tung Tung Sahur’s abode. Some floors are clones of other standalone buildings’ interiors. Some floors have a stalker bot positioned in the middle.',
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

// What each flag of a bot command does; its numbers (the default stay, the longest) are stats.ts's.
export const BOT_FLAG_TEXT: Record<BotFlag, string> = {
  time: 'how long it stays, in seconds',
  name: 'what it plays as',
  skin: 'how it looks: any skin’s command, like elizabeth or tung',
  target: 'who it goes after: the words up to the next flag, each any part of a name',
};

// What each bot's page shows of it: a looping clip, or a still where it's mostly standing still.
export const BOT_MEDIA: Record<BotId, { file: string; caption: string }> = {
  sniper: { file: 'sniper.jpg', caption: 'A sniper bot on a floor of the tower, scoped' },
  circle: { file: 'circle.mp4', caption: 'A circle bot as SpongeBob, circling Patrick' },
  stalker: { file: 'stalker.mp4', caption: 'A stalker bot watching a player walk past' },
};

export const BOT_EXAMPLES: Record<BotId, [string, string]> = {
  sniper: [
    '/sniper-bot -t 500 -n snipah -s elizabeth --target circ',
    'spawns a sniper bot named snipah for 500s with the Elizabeth avatar, targeting players with “circ” in their username.',
  ],
  circle: [
    '/circle-bot --skin tung',
    'spawns a circle bot named circle-bot with the Tung Tung Tung Sahur skin, for the default time.',
  ],
  stalker: ['/stalker-bot -t 60 -n watcher', 'spawns a stalker bot named watcher for 60s.'],
};
