// Named places. When you move into a different one, the client shows its name across the top of the
// screen, and it shows where you are when you join. An area is a part of the outline, from a height
// up if it says so, and the first that matches names the spot: anywhere well up over the main disc
// (the terrace, the sky bridge) is the terrace. The open floor between the buildings, the floor
// bridge and the paths are in no area, and keep the last name.
import type { Vec3 } from '../sim/types';
import { ANNEX, BUILDING_GROUNDS, KRUSTY_KRAB_GROUNDS, MAIN_DISC, partDistance, type WorldPart } from '../sim/world';
import { BUILDING_NAMES } from './buildings';

export interface Area {
  name: string;
  part: WorldPart;
  above?: number; // only with your eyes at least this many metres up
}

export const AREAS: Area[] = [
  { name: 'TUNG TUNG TOWER', part: ANNEX },
  { name: 'TERRACE', part: MAIN_DISC, above: 5 }, // well over a jump
  ...BUILDING_GROUNDS.map((part, n) => ({ name: BUILDING_NAMES[n], part })),
  { name: 'THE KRUSTY KRAB', part: KRUSTY_KRAB_GROUNDS },
];

// The area at an eye position, or null between areas.
export function areaAt({ x, y, z }: Vec3): Area | null {
  return AREAS.find((a) => partDistance(x, z, a.part) <= 0 && y >= (a.above ?? -Infinity)) ?? null;
}
