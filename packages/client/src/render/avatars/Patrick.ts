// Patrick Star: a 2.85 m pink starfish in flowered shorts, one and a half SpongeBobs as on the show,
// from NickBob's Fortnite model (patrickModel.ts, made by scripts/monster-model.py), a Body
// (Body.ts): the cone is head and body in one. Worn with /patrick; its hit capsule is
// AVATARS.patrick.hitbox.
import type { BodySpec } from './Body';
import { PATRICK_MODEL } from './patrickModel';

export const PATRICK: BodySpec = {
  kind: 'patrick',
  model: PATRICK_MODEL,
  texture: '/assets/textures/avatars/patrick.png',
  shadow: 1.7,
  stride: 4.5,
  legSwing: 0.55,
  armSwing: 0.4,
  armsDown: 0.6,
  bob: 0.04,
  follow: 0.35,
};
