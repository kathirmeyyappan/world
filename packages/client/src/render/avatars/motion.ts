// How a jointed body (Jointed.ts) moves, as numbers: a pose is every joint it sets, a stride the pose
// at each moment of a step, and a style everything one character's movement is made of (how it
// stands, its stride at each pace, how it rises, falls and lands). Poses blend channel by channel,
// so a body eases from any of these into any other, and two characters on one rig differ only by
// their styles. Nothing here knows about the renderer: the rig turns a pose into joint rotations.
//
// A pose is in the body's frame, metres and radians: x to its right, y up, z ahead. Its hips are
// placed and turned; its chest and head are turned in the body's frame, not their parent's, so a
// head stays level however the trunk leans under it; each arm is turned at the shoulder from
// hanging straight down and bent at the elbow; and each foot is put where it should be, the rig
// bending the leg to reach it, so feet stay on the ground whatever the hips do.

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

// `a` on the way to `b`, `t` of the way, into `out` (which may be either).
export function mix(out: BodyPose, a: BodyPose, b: BodyPose, t: number): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

// A stride: the walk at one pace, every number its pose is drawn from at each moment of a step.
// A style lists a few, slowest first, and the stride at any pace between two is between them.
export interface Stride {
  pace: number; // the share of the look's full walk this is the stride at (the run is past 1)
  // The feet. Each lands `step` ahead of where it stands and leaves the ground as far behind, down
  // for `duty` of the stride: over half and one is always down, a walk; under it and both are off
  // the ground between steps, a run.
  step: number; // metres
  duty: number;
  lift: number; // metres a foot rises on its way forward
  kick: number; // metres more its heel flicks up behind as it leaves the ground
  spread: number; // metres each foot is carried out to its side of where it stands
  toe: number; // radians the toes point down pushing off
  heel: number; // radians they point up coming down
  // The hips.
  crouch: number; // metres they ride below standing, the knees bent
  bounce: number; // metres they rise and fall with each step
  late: number; // the share of a step after a footfall at which they're lowest
  sway: number; // metres they shift over the foot that's down
  roll: number; // radians they tip, the swinging leg's side dropping
  twist: number; // radians they turn, the hip of the leg going forward leading
  // The trunk and head.
  lean: number; // radians the trunk leans the way it's going
  counter: number; // radians the chest turns against the hips
  rock: number; // radians the chest tips over the foot that's down: a waddle
  nod: number; // the share of the trunk's lean the head takes
  // The arms, each swinging against the leg on its side.
  reach: number; // radians each way they swing
  carry: number; // radians ahead of hanging the swing is centred on
  out: number; // radians they're held out from the sides
  elbow: number; // radians the elbows are bent
  pump: number; // radians more an elbow bends as its arm comes forward, and less as it goes back
  tuck: number; // radians the forearms are turned in across the body
  grip: number; // how closed the hands are: 0 open, 1 fists
}

// Standing still: how the body is held, and the breath that keeps it alive.
export interface Stand {
  pose: BodyPose;
  breath: number; // metres the chest rises and the hips sink with each breath
  seconds: number; // one breath
  shift: number; // metres the hips drift from side to side, slowly, over three breaths
}

// Everything one character's movement is made of.
export interface Style {
  stand: Stand;
  strides: Stride[]; // slowest first
  rise: BodyPose; // going up in the air
  fall: BodyPose; // coming down
  // Legs that scissor in the air, one ahead as the other goes back: how often, how far each way and
  // how high the back one's foot comes.
  flutter?: { hz: number; reach: number; lift: number };
  land: BodyPose; // the crouch a hard landing drops into
  landSpeed: number; // m/s of fall that drops all the way into it
  landSeconds: number; // the crouch's half-life
  dead: BodyPose; // lying on its back
  follow: number; // the share of the look's pitch the head takes
}

const STRIDE_KEYS: (keyof Stride)[] = [
  'pace',
  'step',
  'duty',
  'lift',
  'kick',
  'spread',
  'toe',
  'heel',
  'crouch',
  'bounce',
  'late',
  'sway',
  'roll',
  'twist',
  'lean',
  'counter',
  'rock',
  'nod',
  'reach',
  'carry',
  'out',
  'elbow',
  'pump',
  'tuck',
  'grip',
];

// The stride at `pace`, into `out`: between the two listed either side of it, the slowest's below
// them all and the fastest's above.
export function strideAt(out: Stride, strides: Stride[], pace: number): void {
  let i = 1;
  while (i < strides.length - 1 && strides[i].pace < pace) i++;
  const a = strides[i - 1];
  const b = strides[Math.min(i, strides.length - 1)];
  const t = b.pace > a.pace ? Math.min(1, Math.max(0, (pace - a.pace) / (b.pace - a.pace))) : 0;
  for (const key of STRIDE_KEYS) out[key] = a[key] + (b[key] - a[key]) * t;
}

const STRIKE = 0.25; // the share of a foot's time down over which its toes come down from the heel strike
const PUSH = 0.55; // and the share after which its heel starts to lift
const FLICK = 0.6; // the share of its time in the air over which the heel's flick rises and falls
const HIPS_SHARE = 0.4; // the share of the trunk's lean the hips take

// The pose `cycle` of the way through a stride (0 as the right foot comes down, a half as the left
// does), going (`dx`, `dz`) in the body's frame: ahead is (0, 1), and a length under 1 is a stride
// that much smaller, so a body changing direction shortens its steps through the turn.
export function stridePose(out: BodyPose, s: Stride, cycle: number, dx: number, dz: number): void {
  const turn = 2 * Math.PI * cycle;
  const sin = Math.sin(turn);
  const cos = Math.cos(turn);
  const going = Math.hypot(dx, dz);
  out[HIP_X] = s.sway * sin;
  out[HIP_Y] = -s.crouch - s.bounce * going * Math.cos(2 * turn - 2 * Math.PI * s.late);
  out[HIP_Z] = 0;
  out[HIP_LEAN] = s.lean * HIPS_SHARE * dz;
  out[HIP_TURN] = -s.twist * cos * dz;
  out[HIP_TILT] = -s.roll * sin;
  out[CHEST_LEAN] = s.lean * dz;
  out[CHEST_TURN] = s.counter * cos * dz;
  out[CHEST_TILT] = s.rock * sin + s.lean * dx;
  out[HEAD_LEAN] = s.lean * s.nod * dz;
  out[HEAD_TURN] = 0;
  out[HEAD_TILT] = s.rock * sin * s.nod;
  // As the right foot comes down ahead, the left arm is forward and the right back.
  const swing = cos * going;
  arm(out, ARM_L, s, swing);
  arm(out, ARM_R, s, -swing);
  foot(out, FOOT_R, s, cycle, dx, dz, 1);
  foot(out, FOOT_L, s, (cycle + 0.5) % 1, dx, dz, -1);
}

function arm(out: BodyPose, at: number, s: Stride, swing: number): void {
  out[at + ARM_SWING] = s.carry + s.reach * swing;
  out[at + ARM_OUT] = s.out;
  out[at + ARM_IN] = s.tuck;
  out[at + ARM_ELBOW] = Math.max(0, s.elbow + s.pump * swing);
  out[at + ARM_GRIP] = s.grip;
}

// One foot `u` of the way through its own stride, 0 as it comes down.
function foot(out: BodyPose, at: number, s: Stride, u: number, dx: number, dz: number, side: 1 | -1): void {
  let along: number;
  let up = 0;
  let pitch: number;
  if (u < s.duty) {
    const t = u / s.duty;
    along = 1 - 2 * t;
    pitch = -s.heel * Math.max(0, 1 - t / STRIKE) + s.toe * smooth((t - PUSH) / (1 - PUSH));
  } else {
    const t = (u - s.duty) / (1 - s.duty);
    along = 2 * smooth(t) - 1;
    up = s.lift * Math.sin(Math.PI * t) + s.kick * Math.sin(Math.PI * Math.min(1, t / FLICK)) * (1 - t);
    pitch = s.toe * (1 - smooth(t / FLICK)) - s.heel * smooth((t - FLICK) / (1 - FLICK));
  }
  out[at + FOOT_X] = side * s.spread + dx * along * s.step;
  out[at + FOOT_Y] = up * Math.hypot(dx, dz);
  out[at + FOOT_Z] = dz * along * s.step;
  out[at + FOOT_PITCH] = pitch * dz;
  out[at + FOOT_YAW] = 0;
}

// Standing, `seconds` into however long it has stood.
export function standPose(out: BodyPose, stand: Stand, seconds: number): void {
  out.set(stand.pose);
  const breath = Math.sin((2 * Math.PI * seconds) / stand.seconds);
  out[HIP_Y] -= stand.breath * (0.5 + 0.5 * breath);
  out[CHEST_LEAN] -= stand.breath * 2 * breath;
  out[ARM_L + ARM_OUT] += stand.breath * 3 * breath;
  out[ARM_R + ARM_OUT] += stand.breath * 3 * breath;
  out[HIP_X] += stand.shift * Math.sin((2 * Math.PI * seconds) / (stand.seconds * 3));
}

// In the air, moving up at `vy` m/s (down, negative), `seconds` after leaving the ground.
export function airPose(out: BodyPose, style: Style, vy: number, seconds: number): void {
  mix(out, style.rise, style.fall, smooth(0.5 - vy / (2 * APEX)));
  const flutter = style.flutter;
  if (!flutter) return;
  const kick = Math.sin(2 * Math.PI * flutter.hz * seconds);
  out[FOOT_L + FOOT_Z] += flutter.reach * kick;
  out[FOOT_R + FOOT_Z] -= flutter.reach * kick;
  out[FOOT_L + FOOT_Y] += flutter.lift * Math.max(0, -kick);
  out[FOOT_R + FOOT_Y] += flutter.lift * Math.max(0, kick);
}

const APEX = 2.5; // m/s either side of the top of a jump over which a body goes from rising to falling

// 0 to 1 over 0 to 1, flat at both ends.
export function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
