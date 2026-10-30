// Mr. Krabs: a 2.4 m red crab in a light blue shirt and blue trousers, his eyes on stalks a head
// above the shell his face is on, from Anthony Yanez's model (krabsModel.ts, made by
// scripts/monster-model.py), a Body (Body.ts): the shell is head and body in one, and the claws are
// its arms. Worn with /krabs; its hit capsule is AVATARS.krabs.hitbox.
import type { BodySpec } from './Body';
import { KRABS_MODEL } from './krabsModel';

export const KRABS: BodySpec = {
  kind: 'krabs',
  model: KRABS_MODEL,
  texture: '/assets/textures/avatars/krabs.png',
  shadow: 1.5,
  // A scuttle: tiny quick steps, about sixteen a second at a full walk, two a cycle, as in his
  // scuttle loop (audio/Footsteps.ts), with the body rocking from side to side and the claws held up.
  stride: 6.1,
  legSwing: 0.35,
  armSwing: 0.1,
  armsDown: 0.7,
  bob: 0.015,
  sway: 0.06,
  follow: 0.3,
  doubleSided: true, // the shirt and shell are open shells: under the chin you look into the collar
};
