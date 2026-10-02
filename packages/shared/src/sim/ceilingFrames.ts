// Pictures and live pages projected under the middle of a round room's ceiling, face down. Only
// the client draws them (render/CeilingFrames.ts), turning each about its centre to line up with
// whoever is looking; this is the layout, shared so content can be checked by tests.
import type { FrameShow, RoundRoom } from './wallFrames';
import type { Vec3 } from './types';

export const UNDER_CEILING = 1; // metres between the ceiling and a projection
const CLEAR = 0.3; // metres a projection's corners keep from the stair and the wall as it turns

export interface CeilingFrame {
  room: RoundRoom;
  width: number; // metres
  show: FrameShow;
}

export interface CeilingLayout {
  centre: Vec3; // the middle of the projection, at rest
  width: number;
  height: number; // metres along its other side, across the room's floor
}

// Where a projection hangs. Throws if, turning, its corners would reach the stair (or the wall,
// in a room with none).
export function layoutCeilingFrame(f: CeilingFrame): CeilingLayout {
  const { room } = f;
  const height = f.width / f.show.aspect;
  const clear = (room.stair?.inner ?? room.wall.r - room.wall.thickness / 2) - CLEAR;
  if (Math.hypot(f.width, height) / 2 > clear)
    throw new Error(`projection of ${f.show.src} sweeps into the stair or the wall as it turns`);
  return { centre: { x: room.x, y: room.ceiling - UNDER_CEILING, z: room.z }, width: f.width, height };
}
