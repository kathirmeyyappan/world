// The world's named regions (sim/regions.ts): where people spawn, and where pickups float about
// (content/pickups.ts). Reshape a place here, or in the landmark that owns it, and everything
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

// Where people spawn, each as likely, both on the ground of the main area: its middle and its side
// facing the tower.
export const SPAWN_AREAS: Region[] = [
  { kind: 'disc', x: 0, z: 0, r: 15, y: 0 },
  { kind: 'rect', x: 31.5, z: 0, w: 25, d: 30, y: 0 },
];
