// Buildings 1 to 4: one-storey keeps (content/keep.ts) on their grounds round the far side of the
// main disc (sim/outline.ts), each with its main door facing back down the path in. Building n is
// Tung Tung Tower's floor n - 1 standing on its own, doors, stair and frames alike
// (content/towerFrames.ts hangs each floor's frames in both), its stair going on up to a roof like
// the tower's, whose parapet opens over the door onto a staircase up to the terrace
// (content/terrace.ts).
import type { Structure } from '../sim/structures';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { RoundRoom } from '../sim/wallFrames';
import type { Disc } from '../sim/world';
import { keep } from './keep';

const KEEPS = BUILDING_GROUNDS.map(({ x, z }, n) =>
  keep({ x, z, entrance: Math.atan2(-z, -x), floors: [n], roofExit: true }),
);

export const BUILDINGS: Structure[] = KEEPS.flatMap((k) => k.structures);
export const BUILDING_FOOTPRINTS: Disc[] = KEEPS.map((k) => k.footprint);
// Each building's one room, Building 1 first: the same room as the tower's floor of that index.
export const BUILDING_ROOMS: RoundRoom[] = KEEPS.map((k) => k.rooms[0]);
