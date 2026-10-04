// Named places. When you move into a different one, the client shows its name across the top of the
// screen, and it shows where you are when you join. An area is a part of the outline, from a height
// up if it says so, and the first that matches names the spot: the main disc's floor is the main
// area and anywhere up off it (the terrace, the sky bridge) is the terrace. Somewhere in no area
// (the floor bridge, the paths) keeps the last name.
import type { Vec3 } from '../sim/types';
import { ANNEX, BUILDING_GROUNDS, MAIN_DISC, partDistance, type WorldPart } from '../sim/world';

export interface Area {
  name: string;
  part: WorldPart;
  above?: number; // only with your eyes at least this many metres up
}

export const AREAS: Area[] = [
  { name: 'TUNG TUNG TOWER', part: ANNEX },
  { name: 'TERRACE', part: MAIN_DISC, above: 5 }, // well over a jump
  { name: 'MAIN AREA', part: MAIN_DISC },
  ...BUILDING_GROUNDS.map((part, n) => ({ name: `BUILDING ${n + 1}`, part })),
];

// The area at an eye position, or null between areas.
export function areaAt({ x, y, z }: Vec3): Area | null {
  return AREAS.find((a) => partDistance(x, z, a.part) <= 0 && y >= (a.above ?? -Infinity)) ?? null;
}
