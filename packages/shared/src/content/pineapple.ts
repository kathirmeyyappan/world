// SpongeBob's house: the pineapple on Building 1's grounds (sim/outline.ts), its door facing back
// down the path in, on a dune of sand. The house is two models only the client draws
// (render/models/Models.ts): the pineapple outside and the rooms inside, both written by
// scripts/house-model.py with the profile the sim knows them by (content/pineappleProfile.ts) and
// the boxes it collides with inside (content/pineappleInterior.ts: every surface of the rooms and
// what's in them, cut on a grid, so a couch is something to stand on). Round the rooms the shell is
// solid, as hidden rings: the whole thickness outside the ground floor's rooms, a seal just inside
// the skin above them, and from the library's wall out above its floor; open only at the doorway
// and the vestibule behind it, and at the back door and the hall's. The dune rises from the
// grounds' edge to a flat top the house sits on, and bulges a little round it; the rooms' sand
// floor lies on it.
//
// Inside, the rooms are the game's (Battle for Bikini Bottom): the living room through the front
// door, the closet off it, the kitchen behind, the bathroom off the kitchen, the bedroom upstairs
// over the kitchen, and the library on top. A stair round the back of the house climbs from the
// kitchen's back door, standing clear of the shell with rails both sides, to a balcony at the
// hall's door. Upstairs a corridor runs from that door along the bedroom and round the bathroom,
// walled off from the rest of the hall; the ground floor's closet and bathroom are copied off the
// bedroom; and a straight stair of solid steps climbs from the corridor's end through the hall's
// ceiling and a hole in the library's floor, open along the corridor and walled both sides from
// where the corridor's wall meets it. High in the library's wall a round hatch opens, with a
// slide down from it to the floor (both the model's, as the show has them); through it a brick
// lobby, with a flight winding up each way to a gallery round the brick cylinder standing on the
// library's ceiling, and doorways into it; inside, the attic stair climbs through the fruit's
// crown to a railed deck on top: all in the hollow top of the shell, which nothing else can see
// into. Every door swings (sim/doors.ts), the front
// one and the back door outward, the rooms' into the room each closes; each outside door hangs in
// a flat upright face carved into the shell. The path's flagstones lie on the sand, to step on.
import { ramp, roundFloor, roundWall, spiralStairs, terrain, wall, type Box, type Structure } from '../sim/structures';
import { doorPieces, type DoorSpec } from '../sim/doors';
import { BUILDING_GROUNDS } from '../sim/outline';
import type { Region } from '../sim/regions';
import type { Disc } from '../sim/world';
import { PINEAPPLE_BOXES } from './pineappleInterior';
import { PINEAPPLE_PROFILE as SHAPE } from './pineappleProfile';

const GROUND = BUILDING_GROUNDS[0];
const X = GROUND.x;
const Z = GROUND.z;
if (SHAPE.dune.foot !== GROUND.r) throw new Error('the house model laid its dune for other grounds');
export const DUNE_HEIGHT = SHAPE.dune.height; // metres the dune's flat top, and the house's floor, stand above the floor
const GROUND_CORE = 13.3; // radius the shell is solid from on the ground floor: just outside the rooms' outer wall
const SEAL = 0.4; // metres inside the skin the seal above the ground floor begins: just behind the hall's wall
const SEGMENTS = 32; // straight pieces in each collision ring

// The door faces the way in; the model's door faces its +z, so it's turned to match.
const ENTRANCE = Math.atan2(-Z, -X);
export const PINEAPPLE_PLACEMENT = { x: X, y: DUNE_HEIGHT, z: Z, yaw: Math.PI / 2 - ENTRANCE };
const YAW = PINEAPPLE_PLACEMENT.yaw;
// A point in the house's frame (metres, the door facing +z) in the world.
const placed = (lx: number, lz: number) => ({
  x: X + lx * Math.cos(YAW) + lz * Math.sin(YAW),
  z: Z - lx * Math.sin(YAW) + lz * Math.cos(YAW),
});
// An angle in the house's frame, from +x toward +z, in the world; and a bearing there, from +z
// toward +x, as a world angle.
const turned = (angle: number) => angle - YAW;
const bearing = (b: number) => ENTRANCE - b;
// The shell's radius at a height, between the profile's rings.
const skin = (y: number): number => {
  const rings = SHAPE.rings;
  for (let i = 1; i < rings.length; i++) {
    const [y0, r0] = rings[i - 1];
    const [y1, r1] = rings[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return rings[rings.length - 1][1];
};

export const PINEAPPLE_DOORS: DoorSpec[] = SHAPE.doors.map((d) => ({
  id: d.id,
  hinge: placed(d.hinge[0], d.hinge[1]),
  y: DUNE_HEIGHT + d.y,
  bearing: turned(d.bearing),
  reach: d.reach,
  height: d.height,
  thickness: d.thickness,
  swing: d.swing,
}));
export const PINEAPPLE_DOOR = PINEAPPLE_DOORS.find((d) => d.id === 'front')!;
export const PINEAPPLE_FOOTPRINT: Disc = { kind: 'disc', x: X, z: Z, r: Math.max(...SHAPE.rings.map(([, r]) => r)) };
// A spot on each level for placing things (content/regions.ts): the living room, the corridor
// upstairs, and the library's middle, short of the stairwell's hole in its floor.
const { levels } = SHAPE;
export const PINEAPPLE_LEVELS: Region[] = [
  { kind: 'disc', ...placed(-3.5, 10), r: 2.5, y: DUNE_HEIGHT },
  { kind: 'disc', ...placed(14, -4), r: 1.5, y: DUNE_HEIGHT + levels.hall },
  { kind: 'disc', x: X, z: Z, r: 4.5, y: DUNE_HEIGHT + levels.library },
];

// The hollow top of the shell, from the hatch's sill up: the brick lobby outside the hatch, at the
// sill's height, between a wall just inside the hatch's tube's end and the gallery's outer wall
// GALLERY_OUT out from the axis, both WALL thick, with LANDING metres of its inner wall between
// the flights; the gallery round the cylinder, its floor the cylinder's too (the top of the
// library ceiling's boxes, attic.cylinder.floor) and GALLERY_HEAD under its lid; and the
// cylinder's three doorways (DOORWAYS). Under the gallery round the lobby
// the shell is solid, so the lobby's walls and floor run its span alone. The profile's bearings
// run the other way round from the world's.
const { attic, hatch } = SHAPE;
const WALL = 0.3;
const FLOOR = 0.4;
const GALLERY_OUT = 14;
const GALLERY_HEAD = 9; // metres of headroom over the gallery: its lid as high as the shell allows round the gallery's wall
const LANDING = 3.6;
const TREAD = 0.32; // metres a lobby step runs at the flight's outer edge
const DOORWAY = { width: 2.8, height: 4.4 };
// The cylinder's doorways, in degrees past the hatch's bearing: a third of a turn apart, the attic
// stair's foot just past the first (house_interior.py, ATTIC_START) so the flight passes high over the others.
const DOORWAYS = [90, 210, 330];
const COLLAR_ROW = 0.1; // metres tall each brick row of the lobby's wall round the hatch's tube is: the hole's steps
const IN_SLAB = 0.02; // metres a wall or flight under a floor of another look stops short of its top, inside its slab, so the two never share a plane
const UNDER_TUBE = 0.01; // metres the lobby's floor, and its wall under the tube, sit below the tube's floor, so no two faces share a plane
const hatchAngle = bearing(hatch.bearing);
const lobbyFloor = DUNE_HEIGHT + hatch.sill;
const topFloor = DUNE_HEIGHT + attic.cylinder.floor;
const lobbyIn = hatch.outer - WALL;
const flightTurn = (Math.ceil((topFloor - lobbyFloor) / 0.25) * TREAD) / GALLERY_OUT; // radians each flight winds
const lobbySpan = LANDING / 2 / hatch.outer + flightTurn; // radians either side of the hatch the lobby runs
const cylinderR = attic.cylinder.r + attic.cylinder.thickness / 2;
const at = (r: number, angle: number) => ({ x: X + r * Math.cos(angle), z: Z + r * Math.sin(angle) });
// Everything but the lobby's span, between two heights: the gap that leaves a ring the lobby's
// walls alone; and the lobby's own span, what the hidden shell leaves open round it.
const beyondLobby = (bottom: number, top: number) => ({
  angle: hatchAngle + Math.PI,
  width: 2 * Math.PI - 2 * lobbySpan,
  bottom,
  top,
});
const lobbySpanGap = (bottom: number, top: number) => ({ angle: hatchAngle, width: 2 * lobbySpan, bottom, top });
// The hatch's tube through the library's wall: a gap in the wall's rings at radius r.
const hatchGap = (r: number) => ({
  angle: hatchAngle,
  width: (hatch.across + 0.4) / r,
  bottom: lobbyFloor,
  top: lobbyFloor + hatch.centre + hatch.across / 2 + 0.2,
});
// The lobby's wall closed round the tube: brick rows COLLAR_ROW tall, each running along the
// wall's circle from its gap (a little into the wall beside it, so the two meet) to the tube's
// side at the row's widest, so the brick never enters the tube, leaving a stepped round hole the
// tube passes through; the wall's own pieces take over above the tube's top, and under its floor
// (UNDER_TUBE below it, like the lobby's floor).
const hatchCollar = (): Box[] => {
  const r = lobbyIn + WALL / 2;
  const radius = hatch.across / 2;
  const rows = Math.round((hatch.centre + radius) / COLLAR_ROW);
  const halfGap = hatchGap(r).width / 2 + 0.05 / r;
  const pieces: Box[] = [];
  for (let i = 0; i < rows; i++) {
    const y0 = i === 0 ? -UNDER_TUBE : ((hatch.centre + radius) * i) / rows;
    const y1 = ((hatch.centre + radius) * (i + 1)) / rows;
    const widest = Math.min(Math.max(hatch.centre, y0), y1); // the row's height nearest the circle's centre
    const half = Math.sqrt(Math.max(radius * radius - (widest - hatch.centre) ** 2, 0)) + 0.03;
    for (const side of [-1, 1]) {
      const a = at(r, hatchAngle + side * halfGap);
      const b = at(r, hatchAngle + side * Math.asin(half / r));
      pieces.push({ ...wall(a, b, y1 - y0, WALL, lobbyFloor + y0), material: 'brick' });
    }
  }
  return pieces;
};

// What's open through the shell's rings between two heights above the floor: the doorways (the
// back door's and the hall's; each `width` metres across at the ring's radius) and the flat faces
// round the doors, which have walls of their own (`faceWalls`), each as a gap.
const openings = (bottom: number, top: number, r: number) =>
  [...SHAPE.doorways.map((g) => ({ ...g, arc: g.width / r })), ...SHAPE.faces]
    .filter((g) => g.bottom < top && g.top > bottom)
    .map((g) => ({
      angle: bearing(g.bearing),
      width: g.arc,
      bottom: DUNE_HEIGHT + Math.max(bottom, g.bottom),
      top: DUNE_HEIGHT + Math.min(top, g.top),
    }));

// The shell, band by band between its rings and the levels where what's inside changes, all
// unseen (the model is the shell's look). Each band is a ring from where the solid begins out to
// the skin where it stands outermost in the band (so nothing stands inside it), with the openings
// left out of it: the whole thickness outside the ground floor's rooms, then only a seal inside
// the skin, behind the hall's wall; from the library's floor up, solid from its wall's inside out
// to the skin (nothing stands between them), and above the library's wall a seal again, round the
// hollow top the attic stair climbs. Where the skin
// is flattened into a face round a door the rings are open and the face's own wall stands, chord
// by chord.
const edges = [
  ...new Set([
    ...SHAPE.rings.map(([y]) => y),
    levels.hall,
    levels.library,
    hatch.sill,
    attic.cylinder.floor,
    levels.top,
  ]),
].sort((a, b) => a - b);
const ring = (inner: number, outer: number, y0: number, y1: number, extra: ReturnType<typeof hatchGap>[] = []): Box[] =>
  roundWall({
    x: X,
    z: Z,
    r: (outer + inner) / 2,
    thickness: outer - inner,
    y: DUNE_HEIGHT + y0,
    h: y1 - y0,
    segments: SEGMENTS,
    gaps: [...openings(y0, y1, (outer + inner) / 2), ...extra],
    hidden: true,
  });
const face: Box[] = SHAPE.faceWalls.map(([x1, z1, x2, z2, y0, y1]) => ({
  ...wall(placed(x1, z1), placed(x2, z2), y1 - y0, SHAPE.faceThickness, DUNE_HEIGHT + y0),
  hidden: true,
}));
const shell: Structure[] = edges.slice(1).flatMap((y1, i): Structure[] => {
  const y0 = edges[i];
  const outer = Math.max(skin(y0), skin(y1));
  if (y0 >= levels.top) return ring(outer - SEAL, outer, y0, y1);
  if (y0 < levels.hall) return ring(GROUND_CORE, outer, y0, y1);
  if (y0 < levels.library) return ring(outer - SEAL, outer, y0, y1);
  const [, inner] = SHAPE.library.reduce((band, next) => (next[0] <= y0 ? next : band), SHAPE.library[0]);
  if (y0 < hatch.sill) return ring(inner, outer, y0, y1);
  // Beside the lobby and the gallery: the library's wall alone, open for the hatch's tube, solid
  // under the gallery round the lobby, and the shell outside the gallery's wall.
  const under = Math.min(y1, attic.cylinder.floor);
  return [
    ...ring(inner, lobbyIn, y0, under, [hatchGap((inner + lobbyIn) / 2)]),
    ...ring(lobbyIn, GALLERY_OUT + WALL, y0, under, [lobbySpanGap(DUNE_HEIGHT + y0, DUNE_HEIGHT + under)]),
    ...ring(GALLERY_OUT + WALL, outer, y0, y1),
  ];
});

// The rooms and everything in them.
const rooms: Box[] = PINEAPPLE_BOXES.map(([x, z, y, w, d, h]) => ({
  kind: 'box',
  ...placed(x, z),
  yaw: YAW,
  w,
  d,
  h,
  y: DUNE_HEIGHT + y,
  hidden: true,
}));

// The stair round the back, from the kitchen's back door up to the platform at the hall's door,
// and the stairwell from the corridor's end upstairs to the library, each piece a box.
type Piece = readonly [number, number, number, number, number, number, number];
const piece = ([x, z, y, w, d, h, yaw]: Piece): Box => ({
  kind: 'box',
  ...placed(x, z),
  y: DUNE_HEIGHT + y,
  yaw: YAW + yaw,
  w,
  d,
  h,
  material: 'wood',
});
const flights: Box[] = [...SHAPE.stair.map(piece), ...SHAPE.stairwell.map(piece)];

// The lobby: its floor (a ring, the rest of it sealed off behind the end walls), the wall toward
// the library with the hatch's opening, the end walls, and a flight of solid steps up each way;
// the gallery: its floor, open over the lobby exactly as far as the flights run, its outer wall
// from the lobby's floor up to its lid, the lid, and the cylinder's own floor a hair over the
// library's ceiling; and the cylinder with its doorways, the attic stair's slabs and rail posts
// up it, and the deck on the crown with the hole the stair arrives through and a rail round the
// edge (a 50 m drop).
const DECK_RAIL = 1.0;
const top: Structure[] = [
  ...roundFloor({
    x: X,
    z: Z,
    r: GALLERY_OUT + WALL,
    inner: lobbyIn,
    y: lobbyFloor - UNDER_TUBE,
    thickness: FLOOR,
    hole: { inner: lobbyIn, from: hatchAngle + lobbySpan, to: hatchAngle - lobbySpan + 2 * Math.PI, exact: true },
    material: 'brick',
  }),
  ...roundWall({
    x: X,
    z: Z,
    r: lobbyIn + WALL / 2,
    thickness: WALL,
    y: lobbyFloor - FLOOR,
    h: topFloor - IN_SLAB - (lobbyFloor - FLOOR),
    segments: 48,
    gaps: [
      {
        ...hatchGap(lobbyIn + WALL / 2),
        bottom: lobbyFloor - UNDER_TUBE,
        top: lobbyFloor + hatch.centre + hatch.across / 2,
      },
      beyondLobby(lobbyFloor - FLOOR, topFloor),
    ],
    material: 'brick',
  }),
  ...hatchCollar(),
  ...[-1, 1].map((side): Box => ({
    ...wall(
      at(lobbyIn, hatchAngle + side * lobbySpan),
      at(GALLERY_OUT + WALL, hatchAngle + side * lobbySpan),
      topFloor - IN_SLAB - (lobbyFloor - FLOOR),
      WALL,
      lobbyFloor - FLOOR,
    ),
    material: 'brick',
  })),
  ...[-1, 1].flatMap((side) =>
    spiralStairs({
      x: X,
      z: Z,
      inner: hatch.outer + 0.05,
      outer: GALLERY_OUT - 0.05,
      bottom: lobbyFloor - UNDER_TUBE, // resting on the lobby's floor
      rise: topFloor - IN_SLAB - (lobbyFloor - UNDER_TUBE),
      turns: (side * flightTurn) / (2 * Math.PI),
      start: hatchAngle + side * (lobbySpan - flightTurn),
      thickness: Infinity,
      material: 'wood',
    }),
  ),
  ...roundFloor({
    x: X,
    z: Z,
    r: GALLERY_OUT + 0.1,
    inner: cylinderR,
    y: topFloor,
    thickness: FLOOR,
    hole: { inner: lobbyIn, from: hatchAngle - lobbySpan, to: hatchAngle + lobbySpan, exact: true },
    material: 'red-tile',
  }),
  ...roundWall({
    x: X,
    z: Z,
    r: GALLERY_OUT + WALL / 2,
    thickness: WALL,
    y: lobbyFloor - FLOOR,
    h: topFloor + GALLERY_HEAD + FLOOR - (lobbyFloor - FLOOR),
    segments: 48,
    gaps: [beyondLobby(lobbyFloor - FLOOR, topFloor)],
    material: 'brick',
  }),
  ...roundFloor({
    x: X,
    z: Z,
    r: GALLERY_OUT + WALL,
    inner: cylinderR,
    y: topFloor + GALLERY_HEAD + FLOOR,
    thickness: FLOOR,
    material: 'brick',
  }),
  ...roundFloor({
    x: X,
    z: Z,
    r: attic.cylinder.r + 0.1,
    y: topFloor,
    thickness: attic.cylinder.floor - attic.cylinder.bottom - 0.02,
    material: 'red-tile',
  }),
  ...roundWall({
    x: X,
    z: Z,
    r: cylinderR,
    thickness: attic.cylinder.thickness,
    y: DUNE_HEIGHT + attic.cylinder.bottom,
    h: attic.cylinder.top - attic.cylinder.bottom,
    segments: 48,
    gaps: DOORWAYS.map((deg) => ({
      angle: hatchAngle + (deg * Math.PI) / 180,
      width: DOORWAY.width / cylinderR,
      bottom: topFloor - IN_SLAB,
      top: topFloor + DOORWAY.height,
    })),
    material: 'brick',
  }),
  ...attic.steps.map(piece),
  // The deck in two: inside the cylinder's wall, with the hole the stair arrives through; and from
  // the wall out to the edge, whole, so the hole opens on nothing but the stair. The sectors
  // overlap, so their planks run one way across the deck.
  ...roundFloor({
    x: X,
    z: Z,
    r: cylinderR - attic.cylinder.thickness + 0.05,
    y: DUNE_HEIGHT + attic.deck.y,
    thickness: attic.deck.thickness,
    hole: { inner: attic.deck.hole.inner, from: bearing(attic.deck.hole.to), to: bearing(attic.deck.hole.from) },
    material: 'wood',
    worldTop: true,
  }),
  ...roundFloor({
    x: X,
    z: Z,
    r: attic.deck.r,
    inner: cylinderR - attic.cylinder.thickness + 0.05,
    y: DUNE_HEIGHT + attic.deck.y,
    thickness: attic.deck.thickness,
    material: 'wood',
    worldTop: true,
  }),
  ...roundWall({
    x: X,
    z: Z,
    r: attic.deck.r - 0.15,
    thickness: 0.3,
    y: DUNE_HEIGHT + attic.deck.y,
    h: DECK_RAIL,
    segments: 48,
    material: 'wood',
    worldTop: true,
  }),
];
export const PINEAPPLE_DECK: Disc = { kind: 'disc', x: X, z: Z, r: attic.deck.r };

// The path's flagstones, a hair above the sand, each a ramp lying with the dune's slope, so a
// walker steps on and off them where the model draws them; and the slide down from the hatch,
// ramps the same way (the model draws its trough).
const stones: Structure[] = [...SHAPE.stones, ...SHAPE.slide].map(([lx, lz, hx, hz, y, w, h]) => ({
  ...ramp(placed(lx, lz), placed(hx, hz), h, w, DUNE_HEIGHT + y),
  hidden: true,
}));

// Flat on top, down to the floor by the grounds' edge, never steeper than a walk; its underside a
// hair under the floor, so its rim and corners (the grounds are round, it is square) stay out of
// sight beneath it. Heights are over the underside. The same hill the model's garden was laid on.
const { dune: hill } = SHAPE;
const dune = terrain({
  x: X,
  z: Z,
  w: 2 * hill.foot,
  d: 2 * hill.foot,
  y: -0.05,
  material: 'sand',
  height: (ox, oz) => {
    // The terrain samples at offsets in the world's axes; the hill is shaped in the house's frame,
    // the one the garden is laid on it in (scripts/house-model.py, with this same hill).
    const lx = ox * Math.cos(YAW) - oz * Math.sin(YAW);
    const lz = ox * Math.sin(YAW) + oz * Math.cos(YAW);
    const out = Math.hypot(lx, lz);
    const t = Math.max(0, Math.min(1, (hill.foot - out) / (hill.foot - hill.top)));
    const slope = t * t * (3 - 2 * t);
    const bulge = Math.sin(hill.bulges * Math.atan2(lz, lx)) * Math.sin(Math.PI * t);
    return (hill.height + 0.05) * slope + hill.bulge * bulge;
  },
});

export const PINEAPPLE_HOUSE: Structure[] = [
  dune,
  ...stones,
  ...shell,
  ...face,
  ...rooms,
  ...top,
  ...PINEAPPLE_DOORS.flatMap((d) => doorPieces(d)),
  ...flights,
];
