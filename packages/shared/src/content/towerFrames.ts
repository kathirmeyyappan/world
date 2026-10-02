// Murals hung round the inside of Tung Tung Tower (sim/wallFrames.ts). Each is a floor (a room,
// ground first), an angle in degrees round from the main entrance (to your right as you stand in
// the middle facing it), a height in metres, and what it shows; the width follows from the
// picture, and every one is centred halfway up its storey (20 m a storey, so 10 m up on the
// ground floor). The layout throws if one doesn't fit, comes down over a doorway (3 m tall, the
// main one 6 m), or crosses the stair.
//
// The ground floor's stair climbs the wall from 135° round to -45° (315°), 20 m over that half
// turn, so murals there hang on the other half, from 135° on round through 180°, 270° to 315°.
import type { WallFrame } from '../sim/wallFrames';
import { TUNG_TUNG_TOWER_ROOMS } from './tower';

const [GROUND] = TUNG_TUNG_TOWER_ROOMS;

export const TUNG_TUNG_TOWER_FRAMES: WallFrame[] = [
  // Ground floor.
  {
    room: GROUND,
    angle: 225,
    height: 8,
    show: { kind: 'image', src: '/assets/logos/modal.jpeg', aspect: 1, line: 'this world runs on Modal.' },
  },
];
