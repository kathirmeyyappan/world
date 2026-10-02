// Pictures hung round the inside of Tung Tung Tower (sim/wallFrames.ts). Each is a floor (a room,
// ground first), an angle in degrees round from the main entrance (to your right as you stand in
// the middle facing it), a height in metres, and what it shows; the width follows from the
// picture. The layout throws if one covers a door or sits behind the low steps of a stair.
//
// The ground floor's stair climbs the wall from 135° round to -45° (315°), too low to hang under
// for its first 50° or so; its doors are at 0 (the main entrance), 90, 180 and 270.
import type { WallFrame } from '../sim/wallFrames';
import { TUNG_TUNG_TOWER_ROOMS } from './tower';

const [GROUND] = TUNG_TUNG_TOWER_ROOMS;

export const TUNG_TUNG_TOWER_FRAMES: WallFrame[] = [
  // Ground floor.
  {
    room: GROUND,
    angle: 225,
    height: 2,
    show: { kind: 'image', src: '/assets/logos/modal.jpeg', aspect: 1, line: 'this world runs on Modal.' },
  },
];
