// The world's named regions (sim/regions.ts): where people spawn, and where pickups float about
// (content/pickups.ts). Reshape a place here, or in the landmark that owns it, and everything
// placed in it follows.
import { MAIN_DISC } from '../sim/outline';
import type { Region } from '../sim/regions';
import { STANDING_KEEPS } from './buildings';
import { KRUSTY_KRAB_FLOOR } from './krustyKrab';
import { PINEAPPLE_LEVELS } from './pineapple';
import { TERRACE_DECK } from './terrace';
import { TUNG_TUNG_TOWER_INSIDE, TUNG_TUNG_TOWER_LEVELS } from './tower';

// The floor in the middle of the world, out to where the cubes wander.
export const MIDDLE: Region = { ...MAIN_DISC, y: 0 };
export const TERRACE: Region = TERRACE_DECK;
// Ground floor, the three floors above it, then the roof.
export const TOWER_LEVELS: Region[] = TUNG_TUNG_TOWER_LEVELS;
// The ground floor and the three above it, inside the wall: where the sniper bot starts out.
export const TOWER_INSIDE: Region[] = TUNG_TUNG_TOWER_INSIDE;
// Each building's floor and roof, Building 1 first.
export { BUILDING_LEVELS } from './buildings';
// The Krusty Krab's dining room.
export { KRUSTY_KRAB_FLOOR };

// Somewhere a person can spawn: a region, standing on its floor or anything within a step of it,
// and how likely it is against the others in its list.
export interface SpawnArea {
  region: Region;
  weight: number;
}

// Where people first come in, each as likely, both on the ground in the middle of the world: its
// centre and its side facing the tower.
export const SPAWN_AREAS: SpawnArea[] = [
  { region: { kind: 'disc', x: 0, z: 0, r: 15, y: 0 }, weight: 1 },
  { region: { kind: 'rect', x: 31.5, z: 0, w: 25, d: 30, y: 0 }, weight: 1 },
];

// Where people come back after dying: half the time anywhere on the middle's floor, and otherwise
// the ground floor inside one of the buildings, each as likely: the tower's, each keep's, the
// pineapple's living room and the Krusty Krab's dining room.
const INDOORS: Region[] = [
  TUNG_TUNG_TOWER_INSIDE[0],
  ...STANDING_KEEPS.map((k) => k.levels[0]),
  PINEAPPLE_LEVELS[0],
  KRUSTY_KRAB_FLOOR,
];
export const RESPAWN_AREAS: SpawnArea[] = [
  { region: MIDDLE, weight: INDOORS.length },
  ...INDOORS.map((region) => ({ region, weight: 1 })),
];
