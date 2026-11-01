// SpongeBob SquarePants: a 1.9 m yellow sponge in square pants on thin legs, from Jamessmartguy's
// low-poly model (spongebobModel.ts, made by scripts/monster-model.py), a Body (Body.ts): the
// sponge is head and body in one. Worn with /spongebob; its hit capsule is AVATARS.spongebob.hitbox.
import type { BodySpec } from './Body';
import { SPONGEBOB_MODEL } from './spongebobModel';

export const SPONGEBOB: BodySpec = {
  kind: 'spongebob',
  model: SPONGEBOB_MODEL,
  texture: '/assets/textures/avatars/spongebob.png',
  shadow: 1.3,
  legSwing: 0.6,
  armSwing: 0.5,
  armsDown: 0.6,
  bob: 0.03,
  follow: 0.3,
};
