// Where pickups float (sim/pickups.ts): each area keeps `count` of a kind and brings one back every
// `respawnSeconds` while it's short.
import type { PickupArea } from '../sim/pickups';
import { MAIN_AREA, TERRACE, TOWER_LEVELS } from './regions';

const HEARTS_EVERY = 30;

// Fourteen hearts: three about the main area, one on the terrace, two on each level of the tower.
export const PICKUP_AREAS: PickupArea[] = [
  { region: MAIN_AREA, kind: 'heart', count: 3, respawnSeconds: HEARTS_EVERY },
  { region: TERRACE, kind: 'heart', count: 1, respawnSeconds: HEARTS_EVERY },
  ...TOWER_LEVELS.map((region): PickupArea => ({ region, kind: 'heart', count: 2, respawnSeconds: HEARTS_EVERY })),
];
