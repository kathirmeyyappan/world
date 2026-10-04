// Footprints the minimap fills in grey, so the big structures show on the map. Only what you'd
// navigate by belongs here: a keep, not the decks and rails around it. A disc can carry `rings`,
// circles drawn evenly inside it (Tung Tung Tower has one per floor above the ground, which marks it
// out from the one-storey buildings), or an `inner` radius it's open within.
//
// Up past HIGH_UP the map greys in HIGH_LANDMARKS as well: the walkways up there, which would only
// clutter the map on the ground.
import type { Bridge, Disc } from '../sim/world';
import { BUILDING_FOOTPRINTS } from './buildings';
import { STAIRCASE_FOOTPRINTS, TERRACE_RING } from './terrace';
import { SKY_BRIDGE_FOOTPRINT, TUNG_TUNG_TOWER_FOOTPRINT, TUNG_TUNG_TOWER_ROOMS } from './tower';

export type Landmark = (Disc & { rings?: number; inner?: number }) | Bridge;

export const LANDMARKS: Landmark[] = [
  { ...TUNG_TUNG_TOWER_FOOTPRINT, rings: TUNG_TUNG_TOWER_ROOMS.length - 1 },
  ...BUILDING_FOOTPRINTS,
];

export const HIGH_UP = 35; // metres: the height of your feet past which the map shows HIGH_LANDMARKS
export const HIGH_LANDMARKS: Landmark[] = [
  { kind: 'disc', ...TERRACE_RING },
  SKY_BRIDGE_FOOTPRINT,
  ...STAIRCASE_FOOTPRINTS,
];
