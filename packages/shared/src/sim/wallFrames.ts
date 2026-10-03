// Frames hung on the inside of a round room's wall (one built with roundWall): murals that follow
// the wall round, centred halfway up the room. Pure layout, shared so content can be checked by tests;
// only the client draws them (render/WallFrames.ts), and nothing collides with them, since they
// sit a few centimetres off a wall nobody can walk into.
//
// A frame is a room, an angle round from the room's entrance, a height and what it shows; its
// width is the height times the picture's aspect, and it's centred on the room's `middle`. The wall is straight segments, not a true circle, so
// a frame is laid out as one flat panel per segment it crosses, each parallel to its segment.
import type { Vec3 } from './types';

export const OFF_WALL = 0.03; // metres between the wall and a picture, so the two never share a plane
const CLEAR = 0.3; // metres a frame keeps from a doorway, the floor and the ceiling
const HEADROOM = 2.5; // metres between a stair's steps and a frame over them, for the people on them
const UNDER = 0.5; // metres a stair's steps keep above a frame they pass over: the steps' own depth

// A round room frames can hang in: the floor inside a roundWall.
export interface RoundRoom {
  x: number;
  z: number;
  floor: number; // height of its floor
  ceiling: number; // height of the underside of what's over it
  middle: number; // the height every frame in it is centred at
  wall: { r: number; thickness: number; segments: number }; // the roundWall round it, as built
  entrance: number; // bearing (radians, from +x toward +z) of its way in: a frame's angle 0
  // Openings in the wall: bearings and widths (radians), and how high above the floor they reach.
  doors: { angle: number; width: number; top: number }[];
  // A flight up along the wall, leaving the floor at bearing `from` and climbing `climb` metres a
  // radian as bearings grow, for half a turn.
  stair?: { from: number; climb: number };
}

// What a frame shows: a picture, or a live widget the client draws itself (client/src/widgets),
// and the line typed out while you look at it. `aspect` is width over height.
export type FrameShow =
  | { kind: 'image'; src: string; aspect: number; line: string } // src: a path the client serves
  | { kind: 'widget'; widget: WidgetName; aspect: number; line: string };

// The live widgets a frame can show, after the ones at widgets.kathirm.com.
export type WidgetName = 'spotify';

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
// doesn't fit between floor and ceiling, covers a doorway, or crosses the room's stair.
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

  const bottom = room.middle - f.height / 2 - grow;
  const top = room.middle + f.height / 2 + grow;
  check(f, room, left, right, face, bottom, top);

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

function check(
  f: WallFrame,
  room: RoundRoom,
  left: number,
  right: number,
  face: number,
  bottom: number,
  top: number,
): void {
  const where = `frame at ${f.angle}° (${f.show.kind === 'image' ? f.show.src : f.show.widget})`;
  if (bottom < room.floor + CLEAR || top > room.ceiling - CLEAR) throw new Error(`${where} is too tall for its room`);
  const span = (left - right) / 2;
  const middle = (left + right) / 2;
  for (const door of room.doors)
    if (
      Math.abs(turn(door.angle - middle)) < span + door.width / 2 + CLEAR / face &&
      bottom < room.floor + door.top + CLEAR
    )
      throw new Error(`${where} covers a doorway`);
  const stair = room.stair;
  if (!stair) return;
  // The flight's steps, wherever they run along the frame's stretch of wall, must pass well under
  // it (people climb them) or over it.
  for (let k = 0; k <= 32; k++) {
    const round = (((right + ((left - right) * k) / 32 - stair.from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (round > Math.PI) continue;
    const steps = room.floor + round * stair.climb;
    if (steps > bottom - HEADROOM && steps < top + UNDER) throw new Error(`${where} crosses the stair`);
  }
}

// An angle wrapped to (-π, π].
function turn(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
