// Squidward Tentacles: a 3.2 m octopus in a brown shirt, from Super Tablé's model
// (squidwardModel.ts, made by scripts/avatar-model.py), skinned over twelve bones: the body, the
// head, the arms and four tentacle legs, each in two halves so it bends. He walks as on the show:
// the two tentacles of a side move as one, left and right in turn like a pair of legs, each bending
// as it swings with its foot flopping along behind, and each side's landing a plop (gaits.ts); the
// arms swing against them, the body bobs and rocks, and the head turns with the look. He dies on
// his back with his limbs dropped. Worn with /squidward; his hit capsule is
// AVATARS.squidward.hitbox.
import { TransformNode, Vector3 } from '@babylonjs/core';
import type { Engine } from '../Engine';
import { SkinnedBody } from './skinned';
import { SQUIDWARD_MODEL } from './squidwardModel';
import type { Figure, Leg } from './Walker';

const LEG_SWING = 0.3; // radians each way a tentacle swings from the hip at a full-speed walk
const AIR_LEGS = 0.15;
// The lower half of a tentacle swings this far behind the upper in the stride (radians of it) and
// this much further: the leg bends as it goes, and the foot flops along after it.
const FOOT_LAG = 1.0;
const FOOT_GAIN = 1.4;
const ARM_SWING = 0.2;
const BOB = 0.05; // metres the body rises mid-stride
const SWAY = 0.05; // radians the body rocks to each side with the stride
const HEAD_FOLLOW = 0.6; // how much of the look's pitch the head takes
// Lying on his back: radians the legs and arms drop toward the ground and the head tips back.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;
const DEAD_HEAD = -0.3;

type Bone = keyof typeof SQUIDWARD_MODEL.bones;
const PARENTS: Record<Bone, Bone | null> = {
  body: null,
  head: 'body',
  armL: 'body',
  armR: 'body',
  legFL: 'body',
  legFR: 'body',
  legBL: 'body',
  legBR: 'body',
  footFL: 'legFL',
  footFR: 'legFR',
  footBL: 'legBL',
  footBR: 'legBR',
};
// The left pair swings with the stride, the right pair against it; the two of a side never part.
const LEGS: { leg: Bone; foot: Bone; side: 1 | -1 }[] = [
  { leg: 'legFL', foot: 'footFL', side: 1 },
  { leg: 'legBL', foot: 'footBL', side: 1 },
  { leg: 'legFR', foot: 'footFR', side: -1 },
  { leg: 'legBR', foot: 'footBR', side: -1 },
];

export function buildSquidward(engine: Engine, id: string, base: TransformNode): Figure {
  const skin = new SkinnedBody(engine, `squidward-${id}`, SQUIDWARD_MODEL, 'squidward', PARENTS, base);
  const body = skin.node('body');
  const head = skin.node('head');
  const armR = skin.node('armR');
  // Every part is an open shell: under the collar and up the sleeves you look into other parts.
  skin.material.backFaceCulling = false;
  skin.material.twoSidedLighting = true;

  const grip = new TransformNode(`avatar-grip-${id}`, engine.scene);
  grip.parent = armR;
  grip.position.copyFrom(skin.offset('armR', SQUIDWARD_MODEL.hand));
  const reach = grip.position.normalizeToNew();
  const legs: Leg[] = LEGS.map(({ leg, foot, side }) => ({
    node: skin.node(leg),
    side,
    foot: { node: skin.node(foot), lag: FOOT_LAG, gain: FOOT_GAIN },
  }));

  return {
    tilt: { node: head, follow: HEAD_FOLLOW },
    head,
    legs,
    armL: { node: skin.node('armL'), reach: new Vector3(-reach.x, reach.y, reach.z) },
    armR: { node: armR, grip, reach },
    back: { node: body, at: skin.offset('body', SQUIDWARD_MODEL.back) },
    materials: [skin.material],
    shadow: 1.5,
    legSwing: LEG_SWING,
    airLegs: AIR_LEGS,
    armSwing: ARM_SWING,
    bob: BOB,
    sway: SWAY,
    lie: { onto: 'back', height: SQUIDWARD_MODEL.lie, legs: DEAD_LEGS, arms: DEAD_ARMS, head: DEAD_HEAD },
    dispose: () => skin.dispose(),
  };
}
