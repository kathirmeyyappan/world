// Plankton: a 0.28 m green one-eyed copepod on two stick legs, antennae and all, from Cheryl Hill's
// Battle for Bikini Bottom Rehydrated model (planktonModel.ts, made by scripts/avatar-model.py), a
// Body (Body.ts): his head is most of him. Worn with /plankton; its hit capsule is
// AVATARS.plankton.hitbox.
import type { BodySpec } from './Body';
import { PLANKTON_MODEL } from './planktonModel';

export const PLANKTON: BodySpec = {
  kind: 'plankton',
  model: PLANKTON_MODEL,
  shadow: 0.16,
  legSwing: 0.7,
  armSwing: 0.5,
  armsDown: 1.2, // the model holds his arms straight out
  bob: 0.006,
  follow: 0.3,
  // The guns and packs were made for a person, a dozen times his height.
  itemScale: { weapons: 0.12, packs: 0.1 },
};
