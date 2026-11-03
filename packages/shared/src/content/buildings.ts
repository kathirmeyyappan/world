// Buildings 1 to 4: one-storey keeps (content/keep.ts) on their grounds round the far side of the
// main disc (sim/outline.ts), each with its main door facing back down the path in. Each is one of
// Tung Tung Tower's floors standing on its own, doors and stair alike, and the furnished ones hang
// that floor's frames too (content/towerFrames.ts); its stair goes on up to a roof like the tower's,
// whose parapet opens over the door onto a staircase up to the terrace (content/terrace.ts).
import type { Structure } from '../sim/structures';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
import type { Disc } from '../sim/world';
import { keep } from './keep';

// Each building, Building 1 first: the tower floor it stands, and whether that floor's murals hang
// in it. Buildings 1 and 2 are the tower's ground floor and its first; 3 and 4 stand the same two
// bare for the time being.
export const BUILDING_PLAN = [
  { floor: 0, murals: true },
  { floor: 1, murals: true },
  { floor: 0, murals: false },
  { floor: 1, murals: false },
];

const KEEPS = BUILDING_GROUNDS.map(({ x, z }, n) =>
  keep({ x, z, entrance: Math.atan2(-z, -x), floors: [BUILDING_PLAN[n].floor], roofExit: true }),
);

export const BUILDINGS: Structure[] = KEEPS.flatMap((k) => k.structures);
export const BUILDING_FOOTPRINTS: Disc[] = KEEPS.map((k) => k.footprint);
// Each building's one room, Building 1 first: the same room as the tower's floor it stands.
export const BUILDING_ROOMS: RoundRoom[] = KEEPS.map((k) => k.rooms[0]);
// Each building's floor inside the stair, then its roof, Building 1 first: for placing things.
export const BUILDING_LEVELS: Region[] = KEEPS.flatMap((k) => k.levels);
