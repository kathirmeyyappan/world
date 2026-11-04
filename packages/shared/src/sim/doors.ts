// Doors: a slab hung on a hinge across an opening, shut or swung open, the same for everyone
// because the Room keeps it (room.ts) and tells every client. Shut, it stands across the opening;
// open, turned `swing` round its hinge, it stands beside it; either way it's a wall: `doorPieces`
// makes the two structures, each marked with the door and the state it stands in, which Structures
// turns on and off (collision.ts). The hinge's pin is on the slab's face, the one it swings toward,
// at its edge, so the slab swung square stands clear of its jamb, as a real door hung on its face
// does. A player looking at a door from within DOOR_REACH uses it with a click (InputFrame.use),
// and the Room swings it the other way at once, even mid-swing (the client picks the swing up from
// where it is); only a second click within DOOR_DEBOUNCE_SECONDS is taken for the same click.
// Bots' map leaves doors out, so they walk as if every door stood open.
import { wall, type Box } from './structures';

export interface DoorSpec {
  id: string;
  hinge: { x: number; z: number }; // the pin, on the floor the door stands on
  y: number; // that floor's height
  bearing: number; // the way the slab runs from the hinge when shut (radians from +x toward +z)
  reach: number; // metres the slab runs from the hinge
  height: number;
  thickness: number; // metres the slab hangs behind its face, to the right of the way it runs
  swing: number; // radians the slab turns round the hinge to open, the same way round as the bearing
}

export const DOOR_REACH = 16; // metres along the look from the eye to the slab
export const DOOR_SWING_SECONDS = 0.8; // how long the client draws a swing taking
export const DOOR_DEBOUNCE_SECONDS = 0.2;

export function doorPieces(door: DoorSpec): Box[] {
  return [false, true].map((open) => {
    const a = door.bearing + (open ? door.swing : 0);
    const back = { x: (door.thickness / 2) * Math.sin(a), z: (-door.thickness / 2) * Math.cos(a) };
    const from = { x: door.hinge.x + back.x, z: door.hinge.z + back.z };
    const to = { x: from.x + door.reach * Math.cos(a), z: from.z + door.reach * Math.sin(a) };
    return { ...wall(from, to, door.height, door.thickness, door.y), door: { id: door.id, open }, hidden: true };
  });
}

// The way a player looks, as a unit vector: yaw 0 is +z, positive pitch looks down.
export function lookVector(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const flat = Math.cos(pitch);
  return { x: Math.sin(yaw) * flat, y: -Math.sin(pitch), z: Math.cos(yaw) * flat };
}
