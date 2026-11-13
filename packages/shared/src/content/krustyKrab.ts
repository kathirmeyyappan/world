// The Krusty Krab, on its grounds across the main disc from the tower (sim/outline.ts), its door
// facing back toward the middle. It is a model only the client draws (render/models/Models.ts),
// written by scripts/krusty-krab-model.py from a Sketchfab model with the profile the sim knows it
// by (content/krustyKrabProfile.ts): everything solid as boxes, the roof's leaning staves as the
// wedges under their outer faces, and the two leaves of the glass door. All of it stands here as
// hidden structures, so what you bump into is the generator's to keep true to the model.
//
// A barrel of timber between two arches, 36 m long, 24 m deep and 18 m to the arches' tops, on a
// plinth too tall to step onto (a jump lands on it), glazed along the front and under the arches.
// Inside, the dining room, tables and barrels to stand on, and the cashier's boat in front of the
// kitchen's wall; the kitchen is a solid block with a loft on top that only a jetpack reaches. The
// building is the size that puts Squidward, standing in the boat, with the top of his head a third
// of the way up the order window.
import { doorPieces, type DoorSpec } from '../sim/doors';
import { KRUSTY_KRAB_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import { ramp, type Structure } from '../sim/structures';
import { KRUSTY_KRAB_PROFILE as SHAPE } from './krustyKrabProfile';

const { x: X, z: Z } = KRUSTY_KRAB_GROUNDS;
// The door faces the way in; the model's door faces its +z, so it's turned to match.
const ENTRANCE = Math.atan2(-Z, -X);
export const KRUSTY_KRAB_PLACEMENT = { x: X, y: 0, z: Z, yaw: Math.PI / 2 - ENTRANCE };
const YAW = KRUSTY_KRAB_PLACEMENT.yaw;
// A point in the building's frame (metres, the door facing +z) in the world.
const placed = (lx: number, lz: number) => ({
  x: X + lx * Math.cos(YAW) + lz * Math.sin(YAW),
  z: Z - lx * Math.sin(YAW) + lz * Math.cos(YAW),
});

// The front door: both leaves are one door to the sim, so a click on either swings the pair.
export const KRUSTY_KRAB_DOOR = 'krusty-krab';
export const KRUSTY_KRAB_LEAVES: (DoorSpec & { part: string })[] = SHAPE.doors.map((d) => ({
  id: KRUSTY_KRAB_DOOR,
  part: d.part,
  hinge: placed(d.hinge[0], d.hinge[1]),
  y: 0,
  bearing: d.bearing - YAW,
  reach: d.reach,
  height: d.height,
  thickness: d.thickness,
  swing: d.swing,
}));

export const KRUSTY_KRAB: Structure[] = [
  ...SHAPE.boxes.map(([x, z, y, w, d, h, yaw]): Structure => ({
    kind: 'box',
    ...placed(x, z),
    y,
    w,
    d,
    h,
    yaw: YAW + yaw,
    hidden: true,
  })),
  ...SHAPE.ramps.map(([lowX, lowZ, highX, highZ, y, w, h]): Structure => ({
    ...ramp(placed(lowX, lowZ), placed(highX, highZ), h, w, y),
    hidden: true,
  })),
  ...KRUSTY_KRAB_LEAVES.flatMap(doorPieces),
];

// A spot in the dining room for placing things (content/regions.ts): between the door and the
// boat, clear of the tables and the posts.
export const KRUSTY_KRAB_FLOOR: Region = { kind: 'disc', ...placed(0, 4.5), r: 2.5, y: SHAPE.floor };

// The building on the floor, for the maps (content/landmarks.ts): its plinth, `w` along the
// building and `d` through it, turned with it.
export const KRUSTY_KRAB_FOOTPRINT = { x: X, z: Z, w: SHAPE.size.w, d: SHAPE.size.d, yaw: YAW };
