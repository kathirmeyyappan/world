// The world's named regions (sim/regions.ts): where people spawn, and where pickups float about
// (content/pickups.ts). Reshape a place here, or in the landmark that owns it, and everything
// placed in it follows.
import { MAIN_DISC } from '../sim/outline';
import type { Region } from '../sim/regions';
import { TUNG_TUNG_TERRACE, TUNG_TUNG_TOWER_LEVELS } from './tower';

export const MAIN_AREA: Region = { ...MAIN_DISC, y: 0 };
export const TERRACE: Region = TUNG_TUNG_TERRACE;
// Ground floor, the three floors above it, then the roof.
export const TOWER_LEVELS: Region[] = TUNG_TUNG_TOWER_LEVELS;

// Where people spawn: the main area only, never the tower's grounds or any area added later.
export const SPAWN_AREA: Region = MAIN_AREA;
