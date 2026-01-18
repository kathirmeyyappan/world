/**
 * Simple, serializable game state for multiplayer sync.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlayerState {
  id: string;
  position: Vec3;
  rotation: Vec3;
  velocityY: number;
}

export interface CubeState {
  id: string;
  position: Vec3;
  rotation: Vec3;
  targetPosition: Vec3;
  isHovered: boolean;
  // Animation params (set once, don't change)
  time: number;
  wanderSpeed: number;
  floatFrequency: number;
  rotationSpeed: number;
}

export interface GameState {
  world: { radius: number };
  players: Record<string, PlayerState>;
  cubes: Record<string, CubeState>;
}
