// Frames hung on the inside of a round room's wall (one built with roundWall): pictures that follow
// the wall round, centred at eye level. Pure layout, shared so content can be checked by tests;
// only the client draws them (render/WallFrames.ts), and nothing collides with them, since they
// sit a few centimetres off a wall nobody can walk into.
//
// A frame is a room, an angle round from the room's entrance, a height and what it shows; its
// width is the height times the picture's aspect, and it's centred at HANG (raised, if it's too
// tall for that, to sit just off the floor). The wall is straight segments, not a true circle, so
// a frame is laid out as one flat panel per segment it crosses, each parallel to its segment.
import type { Vec3 } from './types';

export const HANG = 1.85; // metres above the floor every frame is centred at: just over eye level
const FLOOR_GAP = 0.1; // metres a frame too tall to centre at HANG keeps off the floor
export const OFF_WALL = 0.03; // metres between the wall and a picture, so the two never share a plane
const DOOR_MARGIN = 0.3; // metres a frame keeps from a doorway's edge
const HEADROOM = 2.5; // metres the steps of a stair along the wall must clear a frame's top by

// A round room frames can hang in: the floor inside a roundWall.
export interface RoundRoom {
  x: number;
  z: number;
  floor: number; // height of its floor
  wall: { r: number; thickness: number; segments: number }; // the roundWall round it, as built
  entrance: number; // bearing (radians, from +x toward +z) of its way in: a frame's angle 0
  doors: { angle: number; width: number }[]; // openings in the wall: bearings and widths, radians
  // A flight up along the wall, leaving the floor at bearing `from` and climbing `climb` metres a
  // radian as bearings grow, for half a turn.
  stair?: { from: number; climb: number };
}

export type FrameShow = {
  kind: 'image';
  src: string; // a path the client serves, like the sky's images
  aspect: number; // width over height
  line: string; // typed out while you look at it
};

export interface WallFrame {
  room: RoundRoom;
  angle: number; // degrees round from the entrance, to your right as you stand in the middle facing it
  height: number; // metres
  show: FrameShow;
}

// One flat piece of a frame: corners bottom-left, bottom-right, top-right, top-left as seen from
// the room, and how far across the frame (0 at its left edge, 1 at its right) its two sides are.
export interface FramePanel {
  corners: [Vec3, Vec3, Vec3, Vec3];
  u: [number, number];
}

export interface FrameLayout {
  panels: FramePanel[];
  centre: Vec3; // the middle of the frame's face
  width: number; // metres along the wall
  bottom: number;
  top: number;
}

// Where a frame goes, `offset` metres off the wall and grown by `grow` metres on every side (a
// border behind the picture is the same frame, grown and set back). Throws if the frame, grown,
// covers a doorway or sits behind the low steps of the room's stair.
export function layoutWallFrame(f: WallFrame, offset = OFF_WALL, grow = 0): FrameLayout {
  const { room } = f;
  const { r, thickness, segments } = room.wall;
  const step = (2 * Math.PI) / segments;
  // Each segment is a box between two points on the circle 0.52 of a step either side of its
  // middle (roundWall), so its inside face is this far from the centre at its middle.
  const face = r * Math.cos(step * 0.52) - thickness / 2 - offset;
  const width = f.height * f.show.aspect;
  const centreBearing = room.entrance - (f.angle * Math.PI) / 180;
  const half = (width / 2 + grow) / face;
  const left = centreBearing + half; // bearings shrink to the right, seen from inside
  const right = centreBearing - half;

  const pictureBottom = room.floor + Math.max(FLOOR_GAP, HANG - f.height / 2);
  const bottom = pictureBottom - grow;
  const top = pictureBottom + f.height + grow;
  check(f, room, left, right, face, top);

  // Cut the span at segment edges, left to right, and put each piece on its segment's face.
  const cuts = [left];
  for (let edge = (Math.floor(left / step - 0.5) + 0.5) * step; edge > right; edge -= step)
    if (edge < left) cuts.push(edge);
  cuts.push(right);
  // The point on a segment's face (the one whose middle is at bearing `middle`) at a bearing. Two
  // neighbouring segments give the same point for the bearing of the edge between them.
  const onFace = (bearing: number, middle = Math.round(bearing / step) * step) => {
    const d = face / Math.cos(bearing - middle);
    return { x: room.x + Math.cos(bearing) * d, z: room.z + Math.sin(bearing) * d };
  };
  const pieces = cuts.slice(1).map((b, i) => {
    const middle = Math.round((cuts[i] + b) / 2 / step) * step;
    return { a: onFace(cuts[i], middle), b: onFace(b, middle) };
  });
  const lengths = pieces.map(({ a, b }) => Math.hypot(b.x - a.x, b.z - a.z));
  const total = lengths.reduce((s, l) => s + l, 0);
  let along = 0;
  const panels = pieces.map(({ a, b }, i): FramePanel => {
    const u: [number, number] = [along / total, (along + lengths[i]) / total];
    along += lengths[i];
    return {
      corners: [
        { ...a, y: bottom },
        { ...b, y: bottom },
        { ...b, y: top },
        { ...a, y: top },
      ],
      u,
    };
  });
  return { panels, centre: { ...onFace(centreBearing), y: (bottom + top) / 2 }, width: total, bottom, top };
}

function check(f: WallFrame, room: RoundRoom, left: number, right: number, face: number, top: number): void {
  const where = `frame at ${f.angle}° (${f.show.src})`;
  const span = (left - right) / 2;
  const middle = (left + right) / 2;
  for (const door of room.doors)
    if (Math.abs(turn(door.angle - middle)) < span + door.width / 2 + DOOR_MARGIN / face)
      throw new Error(`${where} covers a doorway`);
  const stair = room.stair;
  if (!stair) return;
  // Bearings round from the flight's foot where its steps are still too low to hang under.
  const low = (top - room.floor + HEADROOM) / stair.climb;
  for (let k = 0; k <= 16; k++) {
    const round = (((right + ((left - right) * k) / 16 - stair.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (round <= low) throw new Error(`${where} is behind the stair`);
  }
}

// An angle wrapped to (-π, π].
function turn(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
