// Murals hung round the inside of Tung Tung Tower's floors (sim/wallFrames.ts), each floor's again
// in the building that is that floor on its own (content/buildings.ts), where they hang just the
// same. Each is an angle in degrees round from the main entrance (to your right as you stand in the
// middle facing it), a height in metres, and what it shows; the width follows from the picture, and
// every one is centred halfway up its storey (10 m up). The layout throws if one doesn't fit, comes
// down over a doorway (3 m tall, the main one 6 m but on floor 1), or crosses the stair.
//
// The ground floor's stair climbs the wall from 135° round to -45° (315°), 20 m over that half
// turn, so murals there hang on the other half, from 135° on round through 180° and 270°, or
// under the top of the flight past 270°, where its steps run well over them. Each floor's flight
// starts half a turn on from the one below's.
import type { WallFrame } from '../sim/wallFrames';
import { BUILDING_ROOMS } from './buildings';
import { TUNG_TUNG_TOWER_ROOMS } from './tower';

type Mural = Omit<WallFrame, 'room'>;

// Floor 1's covers (from MyAnimeList, cropped to the activity list's 0.7), a band of ten at the
// height of the big frame's middle: six from where the stair has climbed past them round over the
// main door to the big frame, and four from the door at 127.5° to where the stair comes back down to
// them. Each hover names the show.
const COVER_ANGLES = [288, 311.5, 335, 358.5, 22, 45.5, 112, 135, 158, 181];
const COVERS: Mural[] = [
  ['Gintama', 'gintama'],
  ['One Piece', 'one-piece'],
  ['Steins;Gate', 'steins-gate'],
  ['Monogatari Series', 'monogatari'],
  ['March Comes in Like a Lion', 'march-comes-in-like-a-lion'],
  ['Baccano!', 'baccano'],
  ['Made in Abyss', 'made-in-abyss'],
  ['The Tatami Galaxy', 'tatami-galaxy'],
  ['Monster', 'monster'],
  ['Violet Evergarden', 'violet-evergarden'],
].map(([name, file], i) => ({
  angle: COVER_ANGLES[i],
  height: 6,
  show: { kind: 'image', src: `/assets/frames/anime/${file}.jpg`, aspect: 0.7, line: name },
}));

// Each floor's murals, ground floor (and Building 1) first.
const FLOORS: Mural[][] = [
  // Clear of the doors at 180° and 270°: one between the stair's foot and 180°, one centred in the
  // bay from 180° to 270°, and one under the top of the flight.
  [
    {
      angle: 157.5,
      height: 6.4,
      show: {
        kind: 'image',
        src: '/assets/logos/modal.jpeg',
        aspect: 1,
        line: 'Fun fact: The multiplayer backend for Kathir World runs completely on Modal, via Modal Functions, Modal Servers, and importantly, Sticky Sessions (I helped build this 😎).',
      },
    },
    {
      angle: 225,
      height: 10.8,
      crt: true,
      show: {
        kind: 'image',
        src: '/assets/frames/nepal_libration_force.jpg',
        aspect: 1920 / 1084,
        line: 'I went to UChicago with some interesting fellas. This is the Nepal Liberation Force.',
      },
    },
    {
      angle: 313,
      height: 8,
      crt: true,
      show: {
        kind: 'widget',
        widget: 'spotify',
        aspect: 2,
        line: "This is what I am listening to on Spotify right now (or last listened to). I wonder what it's showing...",
      },
    },
  ],
  // On the bare wall between the main door and the door at 127.5°, floor to ceiling but for about
  // 1.5 m each end, with about 8 m of wall between it and that door.
  [
    {
      angle: 78.75,
      height: 16.5,
      show: {
        kind: 'widget',
        widget: 'anime-activity',
        aspect: 0.8,
        line: 'This frame tracks and emits my recent anime/manga activity.',
      },
    },
    ...COVERS,
  ],
  [],
  [],
];

export const WALL_FRAMES: WallFrame[] = FLOORS.flatMap((murals, s) =>
  [TUNG_TUNG_TOWER_ROOMS[s], BUILDING_ROOMS[s]].flatMap((room) => murals.map((m) => ({ ...m, room }))),
);
