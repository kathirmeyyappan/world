// Sulley (Monsters, Inc.): 2.6 m of teal fur with purple spots, from Guilherme Navarro's low-poly
// model (sulleyModel.ts, made by scripts/avatar-model.py), skinned over eight bones: hips, chest,
// head, the arms, the legs and the tail. It lumbers: short legs stride, the long arms swing against
// them, the chest rolls, the tail sways on its own, and the head follows the look. It dies flat on
// its back with the tail out to one side. Worn with /sulley; its hit capsule is sized to it
// (AVATARS.sulley.hitbox).
import { TransformNode, Vector3 } from '@babylonjs/core';
import type { Engine } from '../Engine';
import { SkinnedBody } from './skinned';
import { SULLEY_MODEL } from './sulleyModel';
import type { Figure } from './Walker';

const LEG_SWING = 0.7; // radians each way at a full-speed walk
const AIR_LEGS = 0.3;
const ARM_SWING = 0.3;
const ROLL = 0.06; // radians the chest rolls side to side with each stride
const BOB = 0.04; // metres the body rises mid-stride
const HEAD_FOLLOW = 0.5; // how much of the look's pitch the head takes
const TAIL_SWAY = 0.25; // radians each way, all the time
const TAIL_SWAY_MS = 1600;
// Lying on its back: radians the legs and arms drop toward the ground and the head tips back.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;
const DEAD_HEAD = -0.4;

type Bone = keyof typeof SULLEY_MODEL.bones;
const PARENTS: Record<Bone, Bone | null> = {
  hips: null,
  chest: 'hips',
  head: 'chest',
  armL: 'chest',
  armR: 'chest',
  legL: 'hips',
  legR: 'hips',
  tail: 'hips',
};

export function buildSulley(engine: Engine, id: string, base: TransformNode): Figure {
  const swayOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TAIL_SWAY_MS;
  const skin = new SkinnedBody(engine, `sulley-${id}`, SULLEY_MODEL, 'sulley', PARENTS, base);
  const chest = skin.node('chest');
  const head = skin.node('head');
  const armR = skin.node('armR');
  const tail = skin.node('tail');

  // A held item goes in the right palm; the flamethrower's tank hangs on the back below the shoulders.
  const grip = new TransformNode(`avatar-grip-${id}`, engine.scene);
  grip.parent = armR;
  grip.position.copyFrom(skin.offset('armR', SULLEY_MODEL.hand));
  const reach = grip.position.normalizeToNew();

  return {
    tilt: { node: head, follow: HEAD_FOLLOW },
    head,
    legs: [
      { node: skin.node('legL'), side: 1 },
      { node: skin.node('legR'), side: -1 },
    ],
    armL: { node: skin.node('armL'), reach: new Vector3(-reach.x, reach.y, reach.z) },
    armR: { node: armR, grip, reach },
    rock: chest,
    back: { node: chest, at: skin.offset('chest', SULLEY_MODEL.back) },
    materials: [skin.material],
    shadow: 1.7,
    legSwing: LEG_SWING,
    airLegs: AIR_LEGS,
    armSwing: ARM_SWING,
    bob: BOB,
    sway: ROLL,
    lie: { onto: 'back', height: SULLEY_MODEL.lie, legs: DEAD_LEGS, arms: DEAD_ARMS, head: DEAD_HEAD },
    // The tail sways on its own; dead, it lies out to one side, out of the floor.
    extra: (p) => {
      tail.rotation.y = p.dead
        ? Math.PI / 2
        : Math.sin(((performance.now() + swayOffset) / TAIL_SWAY_MS) * 2 * Math.PI) * TAIL_SWAY;
    },
    dispose: () => skin.dispose(),
  };
}
