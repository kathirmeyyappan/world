// Mario: 2 m of plumber, as tall as the standard body, from Mario Kart 8's model (marioModel.ts,
// made by scripts/jointed-model.py), a jointed body (Jointed.ts) moved the way the 3D Mario games
// move him. He never jogs: at a full walk he is already running, quick short legs turning over
// under a body that leans in and hardly bobs, fists pumping at his sides; held back he strolls
// upright with his arms loose; and running flat out he is the same run drawn longer and further
// over. He jumps with one fist up and a knee leading, and comes down arms wide. Worn with /mario;
// his hit capsule is AVATARS.mario.hitbox.
import type { JointedSpec } from './Jointed';
import { MARIO_MODEL } from './marioModel';
import { pose, type Stride, type Style } from './motion';

const STROLL: Stride = {
  pace: 0.3,
  step: 0.16,
  duty: 0.6,
  hop: 0,
  lift: 0.08,
  kick: 0.03,
  spread: 0,
  toe: 0.4,
  heel: 0.3,
  crouch: 0.03,
  bounce: 0.02,
  late: 0,
  sway: 0.025,
  roll: 0.04,
  twist: 0.14,
  lean: 0.05,
  counter: 0.12,
  rock: 0.03,
  nod: 0.3,
  reach: 0.5,
  carry: 0.05,
  out: 0.4,
  elbow: 0.5,
  pump: 0.15,
  tuck: 0.1,
  grip: 0.5,
};
// Quick and smooth: the legs turn over fast under a body that hardly rises, each foot down for a
// moment and off the ground the rest, the heel flicking up behind; he leans well in, and his
// fists pump close at his sides. Nothing lands hard: a run that bounces reads as clopping.
const RUN: Stride = {
  pace: 1,
  step: 0.27,
  duty: 0.3,
  hop: 0.045,
  lift: 0.16,
  kick: 0.24,
  spread: 0,
  toe: 0.7,
  heel: 0.25,
  crouch: 0.09,
  bounce: 0.02,
  late: 0.25,
  sway: 0.01,
  roll: 0.03,
  twist: 0.16,
  lean: 0.28,
  counter: 0.18,
  rock: 0,
  nod: 0.35,
  reach: 0.75,
  carry: 0.1,
  out: 0.42,
  elbow: 1.5,
  pump: 0.18,
  tuck: 0.15,
  grip: 1,
};
const SPRINT: Stride = {
  ...RUN,
  pace: 1.6,
  step: 0.31,
  duty: 0.26,
  hop: 0.06,
  lift: 0.18,
  kick: 0.3,
  crouch: 0.11,
  bounce: 0.025,
  twist: 0.2,
  lean: 0.42,
  counter: 0.22,
  reach: 0.9,
  out: 0.45,
};

export const MARIO_STYLE: Style = {
  stand: {
    pose: pose({
      armL: { out: 0.4, elbow: 0.25, in: 0.3 },
      armR: { out: 0.4, elbow: 0.25, in: 0.3 },
      footL: { x: -0.02, yaw: -0.2 },
      footR: { x: 0.02, yaw: 0.2 },
    }),
    breath: 0.012,
    seconds: 2.6,
    shift: 0.01,
  },
  strides: [STROLL, RUN, SPRINT],
  // One fist punched up over the cap, the other arm thrown down and back, the left knee leading
  // and the right leg trailing.
  rise: pose({
    hips: { lean: -0.05 },
    chest: { lean: -0.12, turn: -0.2, tilt: -0.08 },
    head: { lean: -0.2 },
    armR: { swing: 2.9, out: 0.15, elbow: 0.15, grip: 1 },
    armL: { swing: -0.5, out: 0.5, elbow: 0.7, grip: 1 },
    footL: { y: 0.3, z: 0.2, pitch: 0.25 },
    footR: { y: 0.06, z: -0.24, pitch: 0.8 },
  }),
  // Arms thrown out and up for balance, hands open, legs apart and loose under him.
  fall: pose({
    chest: { lean: 0.15 },
    head: { lean: 0.15 },
    armL: { swing: 0.35, out: 1.95, elbow: 0.55 },
    armR: { swing: 0.35, out: 1.95, elbow: 0.55 },
    footL: { x: -0.1, y: 0.12, z: 0.14, pitch: 0.35 },
    footR: { x: 0.1, y: 0.18, z: -0.1, pitch: 0.55 },
  }),
  land: pose({
    hips: { y: -0.2, lean: 0.25 },
    chest: { lean: 0.4 },
    armL: { swing: -0.3, out: 0.9, elbow: 0.5 },
    armR: { swing: -0.3, out: 0.9, elbow: 0.5 },
    footL: { x: -0.06, yaw: -0.25 },
    footR: { x: 0.06, yaw: 0.25 },
  }),
  landSpeed: 14,
  landSeconds: 0.09,
  dead: pose({
    armL: { out: 1.2, elbow: 0.3 },
    armR: { out: 1.2, elbow: 0.3 },
    footL: { x: -0.1, yaw: -0.5 },
    footR: { x: 0.1, yaw: 0.5 },
  }),
  follow: 0.5,
  bank: 0.06,
};

export const MARIO: JointedSpec = { kind: 'mario', model: MARIO_MODEL, style: MARIO_STYLE, shadow: 1.2 };
