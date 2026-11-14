// Mario: 2 m of plumber, as tall as the standard body, from Mario Kart 8's model (marioModel.ts,
// made by scripts/humanoid-model.py), a humanoid (Humanoid.ts) moved the way Super Mario Odyssey moves
// him. He never ambles: at a full walk he is already running, a quick patter of short legs under a
// big head that stays level, leaning in, fists pumping at his chest; held back he strolls upright
// with his arms loose; and running flat out he is the same run drawn longer, further over and
// lower. He jumps with one fist up and a knee leading, and comes down arms wide. Worn with /mario;
// his hit capsule is AVATARS.mario.hitbox.
import type { HumanoidSpec } from './Humanoid';
import { MARIO_MODEL } from './marioModel';
import { pose, type Stride, type Style } from './motion';

const STROLL: Stride = {
  pace: 0.3,
  step: 0.15,
  duty: 0.6,
  lift: 0.07,
  kick: 0.02,
  spread: 0,
  toe: 0.35,
  heel: 0.25,
  crouch: 0.03,
  bounce: 0.012,
  late: 0,
  sway: 0.02,
  roll: 0.03,
  twist: 0.1,
  lean: 0.04,
  counter: 0.08,
  rock: 0.02,
  nod: 0.3,
  reach: 0.4,
  carry: 0.05,
  out: 0.35,
  elbow: 0.4,
  pump: 0.12,
  tuck: 0.1,
  grip: 0.3,
};
const RUN: Stride = {
  pace: 1,
  step: 0.24,
  duty: 0.42,
  lift: 0.15,
  kick: 0.1,
  spread: 0,
  toe: 0.6,
  heel: 0.3,
  crouch: 0.09,
  bounce: 0.035,
  late: 0.2,
  sway: 0.012,
  roll: 0.04,
  twist: 0.18,
  lean: 0.2,
  counter: 0.22,
  rock: 0,
  nod: 0.3,
  reach: 0.85,
  carry: 0.05,
  out: 0.38,
  elbow: 1.35,
  pump: 0.3,
  tuck: 0.1,
  grip: 1,
};
const SPRINT: Stride = {
  ...RUN,
  pace: 1.6,
  step: 0.29,
  duty: 0.36,
  lift: 0.19,
  kick: 0.16,
  toe: 0.75,
  crouch: 0.11,
  bounce: 0.045,
  twist: 0.22,
  lean: 0.36,
  counter: 0.28,
  reach: 1.05,
  carry: 0.05,
  elbow: 1.45,
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
};

export const MARIO: HumanoidSpec = { kind: 'mario', model: MARIO_MODEL, style: MARIO_STYLE, shadow: 1.2 };
