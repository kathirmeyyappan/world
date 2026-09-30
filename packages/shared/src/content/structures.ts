// The world's static geometry: buildings, walls, platforms, ramps and terrain. Add entries here;
// the sim collides with them (sim/collision.ts) and the client draws them (render/Structures.ts).
// Kinds and helpers (wall, ramp, stairs, building, terrain) are in sim/structures.ts. Coordinates
// are the world's: metres, yaw 0 facing +z, the main disc centred on the origin (sim/world.ts).
//
//   export const STRUCTURES: Structure[] = [
//     { kind: 'box', x: 10, z: 10, w: 4, d: 4, h: 1.2 },        // a platform you can step onto
//     ramp({ x: 0, z: 20 }, { x: 0, z: 28 }, 2, 3),              // up to 2 m over 8 m
//     ...stairs({ x: 5, z: 20 }, { x: 5, z: 24 }, 2, 2),          // the same 2 m in 8 steps
//     ...building({ x: -20, z: 15, w: 10, d: 8, h: 4 }),         // four walls, a door and a roof
//   ];
import type { Structure } from '../sim/structures';

export const STRUCTURES: Structure[] = [];
