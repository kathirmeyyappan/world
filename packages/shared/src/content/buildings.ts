// Buildings 1 to 4: one-storey keeps (content/keep.ts) on their grounds round the far side of the
// main disc (sim/outline.ts), each with its main door facing back down the path in. Each is one of
// Tung Tung Tower's floors standing on its own, doors, stair and frames alike
// (content/towerFrames.ts hangs each floor's frames in both), its stair going on up to a roof like
// the tower's, whose parapet opens over the door onto a staircase up to the terrace
// (content/terrace.ts).
import type { Structure } from '../sim/structures';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
import type { Disc } from '../sim/world';
import { keep } from './keep';

// The tower floor each building stands, Building 1 first. Buildings 3 and 4 repeat 1 and 2 for the
// time being; [0, 1, 2, 3] gives each building its own floor.
export const BUILDING_FLOORS = [0, 1, 0, 1];

const KEEPS = BUILDING_GROUNDS.map(({ x, z }, n) =>
  keep({ x, z, entrance: Math.atan2(-z, -x), floors: [BUILDING_FLOORS[n]], roofExit: true }),
);

export const BUILDINGS: Structure[] = KEEPS.flatMap((k) => k.structures);
export const BUILDING_FOOTPRINTS: Disc[] = KEEPS.map((k) => k.footprint);
// Each building's one room, Building 1 first: the same room as the tower's floor it stands.
export const BUILDING_ROOMS: RoundRoom[] = KEEPS.map((k) => k.rooms[0]);
// Each building's floor inside the stair, then its roof, Building 1 first: for placing things.
export const BUILDING_LEVELS: Region[] = KEEPS.flatMap((k) => k.levels);
