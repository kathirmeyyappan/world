export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// One player as the server sees them. `pos` is eye position, not feet.
export interface PlayerState {
  id: string;
  name: string;
  color: string;
  pos: Vec3;
  vy: number;
  yaw: number;
  pitch: number;
  lastSeq: number;
  reading: string | null;
  boost: number; // seconds of /speedy left, 0 when normal
  gun: number; // seconds of /gun left, 0 when unarmed
  dead: boolean; // stays dead until they leave; a rejoin is a new player
}

// One tick of intent from a client. Look is client-authoritative; movement is not.
export interface InputFrame {
  seq: number;
  mx: number;
  my: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  reading: string | null;
}

export interface CubeState {
  id: string;
  pos: Vec3;
  rot: { x: number; y: number };
  target: { x: number; z: number };
  time: number;
  wanderSpeed: number;
  floatFrequency: number;
  rotationSpeed: number;
}
