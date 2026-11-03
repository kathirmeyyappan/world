// Doors: a slab hung on a hinge across an opening, shut or swung open, the same for everyone
// because the Room keeps it (room.ts) and tells every client. Shut, it stands across the opening;
// open, turned `swing` round its hinge, it stands beside it; either way it's a wall: `doorPieces`
// makes the two structures, each marked with the door and the state it stands in, which Structures
// turns on and off (collision.ts). A player looking at a door from within DOOR_REACH uses it with a
// click (InputFrame.use), and the Room swings it the other way once the last swing has had
// DOOR_SWING_SECONDS to finish. Bots' map leaves doors out, so they walk as if every door stood open.
import { wall, type Box } from './structures';

export interface DoorSpec {
  id: string;
  hinge: { x: number; z: number }; // on the floor the door stands on
  y: number; // that floor's height
  bearing: number; // the way the slab runs from the hinge when shut (radians from +x toward +z)
  reach: number; // metres the slab runs from the hinge
  height: number;
  thickness: number;
  swing: number; // radians the slab turns round the hinge to open, the same way round as the bearing
}

export const DOOR_REACH = 16; // metres along the look from the eye to the slab
export const DOOR_SWING_SECONDS = 0.8;

export function doorPieces(door: DoorSpec): Box[] {
  return [false, true].map((open) => {
    const a = door.bearing + (open ? door.swing : 0);
    const end = { x: door.hinge.x + door.reach * Math.cos(a), z: door.hinge.z + door.reach * Math.sin(a) };
    return { ...wall(door.hinge, end, door.height, door.thickness, door.y), door: { id: door.id, open }, hidden: true };
  });
}

// The way a player looks, as a unit vector: yaw 0 is +z, positive pitch looks down.
export function lookVector(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const flat = Math.cos(pitch);
  return { x: Math.sin(yaw) * flat, y: -Math.sin(pitch), z: Math.cos(yaw) * flat };
}
