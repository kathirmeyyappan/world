// The world's named regions (sim/regions.ts): where pickups float about (content/pickups.ts) and
// where bots start out. Reshape a place here, or in the landmark that owns it, and everything
// placed in it follows.
import { MAIN_DISC } from '../sim/outline';
import type { Region } from '../sim/regions';
import { TUNG_TUNG_TERRACE, TUNG_TUNG_TOWER_INSIDE, TUNG_TUNG_TOWER_LEVELS } from './tower';

export const MAIN_AREA: Region = { ...MAIN_DISC, y: 0 };
export const TERRACE: Region = TUNG_TUNG_TERRACE;
// Ground floor, the three floors above it, then the roof.
export const TOWER_LEVELS: Region[] = TUNG_TUNG_TOWER_LEVELS;
// The ground floor and the three above it, inside the wall: where the sniper bot starts out.
export const TOWER_INSIDE: Region[] = TUNG_TUNG_TOWER_INSIDE;
