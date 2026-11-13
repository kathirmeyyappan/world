// Where pickups float (sim/pickups.ts): each area keeps `count` of a kind and brings one back every
// `respawnSeconds` while it's short.
import type { PickupArea, PickupKind } from '../sim/pickups';
import { BUILDING_LEVELS, KRUSTY_KRAB_FLOOR, MAIN_AREA, TERRACE, TOWER_LEVELS } from './regions';

const HEARTS_EVERY = 30;

// What a dead player's body leaves where it lay when it's removed.
export const CORPSE_DROP: PickupKind = 'big-heart';

// Twenty-six hearts: three about the main area, three on the terrace, two on each level of the
// tower, one on each of the buildings' levels (a keep's floor and its roof, the house's three), and
// one in the Krusty Krab's dining room.
export const PICKUP_AREAS: PickupArea[] = [
  { region: MAIN_AREA, kind: 'heart', count: 3, respawnSeconds: HEARTS_EVERY },
  { region: TERRACE, kind: 'heart', count: 3, respawnSeconds: HEARTS_EVERY },
  ...TOWER_LEVELS.map((region): PickupArea => ({ region, kind: 'heart', count: 2, respawnSeconds: HEARTS_EVERY })),
  ...BUILDING_LEVELS.map((region): PickupArea => ({ region, kind: 'heart', count: 1, respawnSeconds: HEARTS_EVERY })),
  { region: KRUSTY_KRAB_FLOOR, kind: 'heart', count: 1, respawnSeconds: HEARTS_EVERY },
];
