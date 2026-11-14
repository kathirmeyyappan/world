// Mario: 2 m of plumber, as tall as the standard body, from Mario Kart 8's model (marioModel.ts,
// made by scripts/jointed-model.py), a jointed body (Jointed.ts) moved by Super Mario 64's own
// animations (marioClips.ts, made by scripts/jointed-clips.py): its idle, walk, run, jump, fall
// and landing. Worn with /mario; his hit capsule is AVATARS.mario.hitbox.
import type { JointedSpec, Style } from './Jointed';
import { MARIO_CLIPS } from './marioClips';
import { MARIO_MODEL } from './marioModel';
import { pose } from './motion';

export const MARIO_STYLE: Style = {
  clips: MARIO_CLIPS,
  landSpeed: 14,
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
