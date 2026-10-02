// Murals hung round the inside of Tung Tung Tower (sim/wallFrames.ts). Each is a floor (a room,
// ground first), an angle in degrees round from the main entrance (to your right as you stand in
// the middle facing it), a height in metres, and what it shows; the width follows from the
// picture, and every one is centred halfway up its storey (20 m a storey, so 10 m up on the
// ground floor). The layout throws if one doesn't fit, comes down over a doorway (3 m tall, the
// main one 6 m), or crosses the stair.
//
// The ground floor's stair climbs the wall from 135° round to -45° (315°), 20 m over that half
// turn, so murals there hang on the other half, from 135° on round through 180°, 270° to 315°.
import type { CeilingFrame } from '../sim/ceilingFrames';
import type { WallFrame } from '../sim/wallFrames';
import { TUNG_TUNG_TOWER_ROOMS } from './tower';

const [GROUND] = TUNG_TUNG_TOWER_ROOMS;

export const TUNG_TUNG_TOWER_FRAMES: WallFrame[] = [
  // Ground floor, clear of the doors at 180° and 270°: one between the stair's foot and 180°, one
  // centred in the bay from 180° to 270°.
  {
    room: GROUND,
    angle: 157.5,
    height: 6.4,
    show: {
      kind: 'image',
      src: '/assets/logos/modal.jpeg',
      aspect: 1,
      line: 'Fun fact: The multiplayer backend for Kathir World runs completely on Modal, via Modal functions, Modal servers, and importantly, Sticky Sessions (I helped build this 😎).',
    },
  },
  {
    room: GROUND,
    angle: 225,
    height: 10.8,
    show: {
      kind: 'image',
      src: '/assets/frames/nepal_libration_force.jpg',
      aspect: 1920 / 1084,
      line: 'I went to UChicago with some interesting fellas. This is the Nepal Liberation Force.',
    },
  },
];

// Projected under the middle of a floor's ceiling (sim/ceilingFrames.ts), turning to line up with
// whoever looks up at it.
export const TUNG_TUNG_TOWER_CEILING_FRAMES: CeilingFrame[] = [
  {
    room: GROUND,
    width: 19,
    show: {
      kind: 'page',
      src: 'https://widgets.kathirm.com/spotify/',
      aspect: 16 / 9,
      width: 800,
      line: "This is what I am listening to on Spotify right now (or last listened to). I wonder what it's showing...",
    },
  },
];
