import type { Vec3 } from './types';

// Unit vector the player is looking along. Matches the client camera: yaw 0 faces +z,
// positive pitch looks down.
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: -Math.sin(pitch), z: Math.cos(yaw) * c };
}
