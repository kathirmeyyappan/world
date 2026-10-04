// Footprints the minimap fills in grey, so the big structures show on the map. Only what you'd
// navigate by belongs here: a keep, not the decks and rails around it. A disc can carry `rings`,
// circles drawn evenly inside it: Tung Tung Tower has one per floor above the ground, which marks it
// out from the one-storey buildings.
import type { WorldPart } from '../sim/world';
import { BUILDING_FOOTPRINTS } from './buildings';
import { TUNG_TUNG_TOWER_FOOTPRINT, TUNG_TUNG_TOWER_ROOMS } from './tower';

export type Landmark = WorldPart & { rings?: number };

export const LANDMARKS: Landmark[] = [
  { ...TUNG_TUNG_TOWER_FOOTPRINT, rings: TUNG_TUNG_TOWER_ROOMS.length - 1 },
  ...BUILDING_FOOTPRINTS,
];
