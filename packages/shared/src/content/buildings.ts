// Buildings 1 to 4 on their grounds round the far side of the main disc (sim/outline.ts), each with
// its door facing back down the path in. Building 1 is SpongeBob's house (content/pineapple.ts).
// The rest are one-storey keeps (content/keep.ts): one of Tung Tung Tower's floors standing on its
// own, doors, stair and frames alike (content/towerFrames.ts hangs each floor's frames in both), or
// a bare keep holding the grounds for something of its own to come, with ladders up its outside to
// the roof too; a keep's stair goes on up to a
// roof like the tower's, whose parapet opens over the door onto a staircase up to the terrace
// (content/terrace.ts).
import type { Structure } from '../sim/structures';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { RoundRoom } from '../sim/wallFrames';
import type { Disc } from '../sim/world';
import { keep } from './keep';
import { PINEAPPLE_FOOTPRINT, PINEAPPLE_HOUSE, PINEAPPLE_LEVELS } from './pineapple';

// What stands on each building's grounds, Building 1 first: the house, or a keep standing the
// tower floor numbered (0 the ground floor, 1 the first), or a bare keep (null: the ground floor's
// shape with nothing hung in it).
export const BUILDING_PLAN: ('house' | number | null)[] = ['house', 0, 1, null];

const KEEPS = BUILDING_GROUNDS.map(({ x, z }, n) => {
  const plan = BUILDING_PLAN[n];
  return plan === 'house'
    ? null
    : keep({ x, z, entrance: Math.atan2(-z, -x), floors: [plan ?? 0], roofExit: true, ladders: true });
});

export const BUILDINGS: Structure[] = KEEPS.flatMap((k) => k?.structures ?? PINEAPPLE_HOUSE);
export const BUILDING_FOOTPRINTS: Disc[] = KEEPS.map((k) => k?.footprint ?? PINEAPPLE_FOOTPRINT);
// What a keep standing a tower floor is called, by the floor: the ground floor's, with the Spotify
// widget, and the first floor's, with the anime list (content/towerFrames.ts).
const ROOM_NAMES: Partial<Record<number, string>> = { 0: 'WELCOME BUILDING', 1: 'ANIME BUILDING' };
// Each building's name, Building 1 first, as the area title shows it on its grounds.
export const BUILDING_NAMES: string[] = BUILDING_PLAN.map((plan, n) =>
  plan === 'house' ? "SPONGEBOB'S HOUSE" : (typeof plan === 'number' && ROOM_NAMES[plan]) || `BUILDING ${n + 1}`,
);
// The rooms standing a tower floor, with which: each is the same room as that floor of the tower.
export const BUILDING_ROOMS: { floor: number; room: RoundRoom }[] = KEEPS.flatMap((k, n) => {
  const floor = BUILDING_PLAN[n];
  return k && typeof floor === 'number' ? [{ floor, room: k.rooms[0] }] : [];
});
// Each building's floors and roofs, Building 1 first: for placing things.
export const BUILDING_LEVELS: Region[] = KEEPS.flatMap((k) => k?.levels ?? PINEAPPLE_LEVELS);
// The keeps standing on the grounds, Building 2 first (the house left out): each one's footprint
// (its wall's outer face) and levels, for what a bot does indoors.
export const STANDING_KEEPS: { footprint: Disc; levels: Region[] }[] = KEEPS.flatMap((k) => (k ? [k] : []));
// The grounds with a keep's roof on them, for the staircases up to the terrace.
export const KEEP_GROUNDS: Disc[] = BUILDING_GROUNDS.filter((_, n) => KEEPS[n]);
