// The round brick keep that Tung Tung Tower and Buildings 1 to 4 are all built as: a wall 20 m out,
// storeys of 20 m sealed by tiled floors, and a wooden stair climbing half a turn against the inside
// of the wall through each storey, up through a hole in the floor above and on through the last one
// to a flagstone roof. The roof is open in the middle behind a parapet, like the terrace, and the
// wall stands on past it with merlons along the top.
//
// Every keep's floors follow one layout, numbered from the tower's ground floor up: where each
// floor's doors are and where its flight starts. A keep stacks consecutive floors of it from the
// ground (the tower all four, each building just its own), turned so its main door faces the way
// in, so a floor is the same room, frames and all, wherever it stands.
import { roundFloor, roundWall, spiralStairs, wall, type Box, type Structure } from '../sim/structures';
import type { RoundRoom } from '../sim/wallFrames';
import type { Disc } from '../sim/world';

export const deg = (d: number) => (d * Math.PI) / 180; // angles run from +x toward +z
export const OUTER = 20; // outside face of the wall
const WALL = 1;
const SEGMENTS = 48; // straight pieces the wall is built from, 7.5° each
const INNER = OUTER - WALL; // inside face of the wall
const STAIR_WIDTH = 3.75;
export const STAIR_INNER = INNER - STAIR_WIDTH;
const FLOOR_R = INNER + WALL / 2; // floors run into the wall, so there's no gap at its foot
export const STOREY = 20;
const GROUND_FLOOR = 0.05; // the ground floor's tiles sit this far above the ground
const SLAB = 0.4; // thickness of the upper floors and the roof
const ROOF_WALL = 1; // the wall stands this far above the roof all the way round (cover to shoot over)
const MERLON = 1.5; // and every other segment stands this far above that
export const OPENING = 8; // the roof is open within this radius
export const RAIL = 1.1; // height of the parapet round the opening
// Door sills and the stair's landings sit this far below the floors they meet, so no two surfaces
// share a height where they overlap (they'd flicker).
export const SILL = 0.02;

// The layout, in the tower's own bearings: its main door faces west (180°), toward the main disc.
const MAIN = deg(180);
const STAIR_START = deg(45); // the ground floor's first step; clear of all four entrances
const HOLE = deg(30); // each floor is open over the last 30° of the flight arriving through it
const DOOR = (2 * Math.PI) / SEGMENTS; // an ordinary door is one wall segment wide
const DOOR_HEIGHT = 3;
// The ground floor's four entrances, and six doors on each floor above (onto the tower's balconies).
// Every floor's stair hole ends at 45° or 225°, where that floor's flight also starts, so the doors
// keep clear of both.
const ENTRANCES = [0, 90, 180, 270].map(deg);
const UPPER_DOORS = [0, 75, 127.5, 180, 255, 307.5].map(deg);

export interface Keep {
  structures: Structure[];
  rooms: RoundRoom[]; // one per floor, lowest first
  footprint: Disc; // the wall on the ground, for the minimap (content/landmarks.ts)
  roof: number; // height of the roof's top
}

// A keep centred on (x, z) holding `floors` of the layout (consecutive, lowest first), its main door
// at bearing `entrance`.
export function keep({ x, z, entrance, floors }: { x: number; z: number; entrance: number; floors: number[] }): Keep {
  const turn = entrance - MAIN; // added to every bearing in the layout
  const roof = floors.length * STOREY;
  const r = OUTER - WALL / 2; // the wall's centreline
  const stair = STAIR_START + floors[0] * Math.PI + turn; // where the lowest flight starts
  const level = (i: number) => (i === 0 ? GROUND_FLOOR : i * STOREY); // the top of floor i
  // Floor i is open (i above 0, or the roof at floors.length) where the flight from below arrives,
  // i half turns on from the lowest flight's start.
  const hole = (i: number) => ({ inner: STAIR_INNER, from: stair + i * Math.PI - HOLE, to: stair + i * Math.PI });
  // Floor i's doorways. The main door (a building's way in, the tower's onto its sky bridge) is
  // twice the others' width and height on every floor, so a floor is the same room in a building.
  const doors = (i: number) =>
    (floors[i] === 0 ? ENTRANCES : UPPER_DOORS).map((angle) => {
      const main = angle === MAIN;
      return { angle: angle + turn, width: main ? 2 * DOOR : DOOR, top: main ? 2 * DOOR_HEIGHT : DOOR_HEIGHT };
    });
  const onWall = (angle: number) => ({ x: x + r * Math.cos(angle), z: z + r * Math.sin(angle) });

  const structures: Structure[] = [
    ...roundWall({
      x,
      z,
      r,
      h: roof + ROOF_WALL, // past the roof, whose edge then ends inside the wall rather than level with its top
      thickness: WALL,
      segments: SEGMENTS,
      gaps: floors.flatMap((_, i) =>
        doors(i).map(({ angle, width, top }) => {
          const bottom = i === 0 ? 0 : i * STOREY - SILL;
          return { angle, width, bottom, top: bottom + top };
        }),
      ),
      material: 'brick',
    }),
    ...spiralStairs({
      x,
      z,
      inner: STAIR_INNER,
      outer: INNER,
      bottom: -SILL, // so each landing's step (and the rail post beneath it) sits just under its floor
      rise: roof,
      turns: floors.length / 2,
      start: stair,
      rail: 1,
      material: 'wood',
    }),
    ...roundFloor({ x, z, r: FLOOR_R, y: GROUND_FLOOR, thickness: GROUND_FLOOR, material: 'red-tile' }),
    ...floors
      .slice(1)
      .flatMap((_, k) =>
        roundFloor({ x, z, r: FLOOR_R, y: level(k + 1), thickness: SLAB, hole: hole(k + 1), material: 'red-tile' }),
      ),
    // The roof, open in the middle behind a parapet, and where the last flight arrives.
    ...roundFloor({
      x,
      z,
      r: FLOOR_R,
      y: roof,
      thickness: SLAB,
      inner: OPENING,
      hole: hole(floors.length),
      material: 'flagstone',
    }),
    ...roundWall({ x, z, r: OPENING + 0.1, y: roof, h: RAIL, thickness: 0.2, segments: 32, material: 'brick' }),
    // Battlements: a merlon on every other segment of the wall above the roof.
    ...Array.from({ length: SEGMENTS / 2 }, (_, k): Box => {
      const a = turn + 2 * k * DOOR;
      const along = 0.045; // half the merlon's arc, in radians
      return { ...wall(onWall(a - along), onWall(a + along), MERLON, WALL, roof + ROOF_WALL), material: 'brick' };
    }),
  ];

  // Frames centre halfway up each storey, and a frame's angle 0 is the main door's bearing on every
  // floor; each floor has the flight that leaves it.
  const rooms = floors.map((_, i): RoundRoom => ({
    x,
    z,
    floor: level(i),
    ceiling: (i + 1) * STOREY - SLAB,
    middle: i * STOREY + STOREY / 2,
    wall: { r, thickness: WALL, segments: SEGMENTS },
    entrance,
    doors: doors(i),
    stair: { from: stair + i * Math.PI, climb: STOREY / Math.PI },
  }));

  return { structures, rooms, footprint: { kind: 'disc', x, z, r: OUTER }, roof };
}
