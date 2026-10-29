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
  stride: 6.5,
  legSwing: 0.6,
  armSwing: 0.35,
  bob: 0.03,
  follow: 0.3,
};
