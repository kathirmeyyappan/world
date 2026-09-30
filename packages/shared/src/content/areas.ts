// Named places. When you move into a different one, the client shows its name across the top of the
// screen, and it shows where you are when you join. An area is a union of places, each a part of
// the outline (a disc or a strip) and optionally only above a height, so the tower's sky bridge
// and terrace belong to the tower even though they hang over the main disc. The first area
// containing you wins; somewhere in none (the floor bridge) keeps the last name.
import { ANNEX, MAIN_DISC, partDistance, type WorldPart } from '../sim/world';
import { SKYWAY_HEIGHT, SKYWAY_REGION } from './tower';

export interface Area {
  name: string;
  places: { part: WorldPart; above?: number }[]; // `above`: only for feet at least this high
}

export const AREAS: Area[] = [
  {
    name: 'TUNG TUNG TOWER',
    places: [{ part: ANNEX }, { part: SKYWAY_REGION, above: SKYWAY_HEIGHT - 1 }],
  },
  { name: 'MAIN AREA', places: [{ part: MAIN_DISC }] },
];

// The area a player with feet at `feet` over (x, z) is in, or null between areas.
export function areaAt(x: number, feet: number, z: number): Area | null {
  return (
    AREAS.find((a) =>
      a.places.some((p) => (p.above === undefined || feet >= p.above) && partDistance(x, z, p.part) <= 0),
    ) ?? null
  );
}
