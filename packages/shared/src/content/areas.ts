// Named places. When you move into a different one, the client shows its name across the top of the
// screen, and it shows where you are when you join. An area is a part of the outline, whatever the
// height: the sky bridge and terrace hanging over the main disc are the main area. Somewhere in no
// area (the floor bridge, the paths) keeps the last name.
import { ANNEX, BUILDING_GROUNDS, MAIN_DISC, partDistance, type WorldPart } from '../sim/world';

export interface Area {
  name: string;
  part: WorldPart;
}

export const AREAS: Area[] = [
  { name: 'TUNG TUNG TOWER', part: ANNEX },
  { name: 'MAIN AREA', part: MAIN_DISC },
  ...BUILDING_GROUNDS.map((part, n) => ({ name: `BUILDING ${n + 1}`, part })),
];

// The area over (x, z), or null between areas.
export function areaAt(x: number, z: number): Area | null {
  return AREAS.find((a) => partDistance(x, z, a.part) <= 0) ?? null;
}
