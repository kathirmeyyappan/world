// A pose of a jointed body (Jointed.ts) that is worked out, not played from a clip: the few a body
// holds that no clip covers (on a ladder, lying dead). It's written as what each part does, in the
// body's frame, metres and radians: x to its right, y up, z ahead. Its hips are placed and turned;
// its chest and head are turned in the body's frame, not their parent's, so a head stays level
// however the trunk leans under it; each arm is turned at the shoulder from hanging straight down
// and bent at the elbow; and each foot is put where it should be, the rig bending the leg to reach
// it.

export type BodyPose = Float64Array;

// A pose's channels. Leans are forward, turns to the right, tilts with the right side down.
export const HIP_X = 0; // metres the hips are from where they stand at rest
export const HIP_Y = 1;
export const HIP_Z = 2;
export const HIP_LEAN = 3;
export const HIP_TURN = 4;
export const HIP_TILT = 5;
export const CHEST_LEAN = 6;
export const CHEST_TURN = 7;
export const CHEST_TILT = 8;
export const HEAD_LEAN = 9;
export const HEAD_TURN = 10;
export const HEAD_TILT = 11;
export const ARM_L = 12; // an arm's five channels start here: ARM_SWING and the rest are offsets from it
export const ARM_R = 17;
export const FOOT_L = 22; // a foot's five
export const FOOT_R = 27;
const CHANNELS = 32;

export const ARM_SWING = 0; // radians ahead of hanging straight down (behind, negative)
export const ARM_OUT = 1; // radians out to its side from hanging: a quarter turn is straight out
export const ARM_IN = 2; // radians the arm is turned about its own length, the elbow's bend swinging in across the body
export const ARM_ELBOW = 3; // radians the elbow is bent
export const ARM_GRIP = 4; // how closed the hand is: 0 open, as the model holds it, 1 a fist

export const FOOT_X = 0; // metres its sole is to the right of where it stands at rest
export const FOOT_Y = 1; // metres its sole is off the ground
export const FOOT_Z = 2; // metres ahead
export const FOOT_PITCH = 3; // radians its toes point down (up, negative)
export const FOOT_YAW = 4; // radians its toes, and the knee over them, point to the right

// A pose as it's written down: whatever isn't named is at rest.
export interface PoseSpec {
  hips?: { x?: number; y?: number; z?: number; lean?: number; turn?: number; tilt?: number };
  chest?: { lean?: number; turn?: number; tilt?: number };
  head?: { lean?: number; turn?: number; tilt?: number };
  armL?: ArmSpec;
  armR?: ArmSpec;
  footL?: FootSpec;
  footR?: FootSpec;
}
interface ArmSpec {
  swing?: number;
  out?: number;
  in?: number;
  elbow?: number;
  grip?: number;
}
interface FootSpec {
  x?: number;
  y?: number;
  z?: number;
  pitch?: number;
  yaw?: number;
}

export function pose(spec: PoseSpec = {}): BodyPose {
  const p = new Float64Array(CHANNELS);
  const { hips = {}, chest = {}, head = {} } = spec;
  p.set([hips.x ?? 0, hips.y ?? 0, hips.z ?? 0, hips.lean ?? 0, hips.turn ?? 0, hips.tilt ?? 0], HIP_X);
  p.set([chest.lean ?? 0, chest.turn ?? 0, chest.tilt ?? 0], CHEST_LEAN);
  p.set([head.lean ?? 0, head.turn ?? 0, head.tilt ?? 0], HEAD_LEAN);
  for (const [at, arm] of [
    [ARM_L, spec.armL ?? {}],
    [ARM_R, spec.armR ?? {}],
  ] as const)
    p.set([arm.swing ?? 0, arm.out ?? 0, arm.in ?? 0, arm.elbow ?? 0, arm.grip ?? 0], at);
  for (const [at, foot] of [
    [FOOT_L, spec.footL ?? {}],
    [FOOT_R, spec.footR ?? {}],
  ] as const)
    p.set([foot.x ?? 0, foot.y ?? 0, foot.z ?? 0, foot.pitch ?? 0, foot.yaw ?? 0], at);
  return p;
}

// 0 to 1 over 0 to 1, flat at both ends.
export function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
