// Footprints the minimap fills in grey, so the big structures show on the map. Only what you'd
// navigate by belongs here: a keep, not the decks and rails around it.
import type { WorldPart } from '../sim/world';
import { TUNG_TUNG_TOWER_FOOTPRINT } from './tower';

export const LANDMARKS: WorldPart[] = [TUNG_TUNG_TOWER_FOOTPRINT];
