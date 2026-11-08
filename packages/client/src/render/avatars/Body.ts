// An avatar whose head is its body: a trunk on two short legs with two arms and nothing else to
// move (Mike Wazowski, SpongeBob), skinned over five bones from a model made by
// scripts/avatar-model.py. The whole body tips with the look, since that is where the face is, and
// it dies on its back with its limbs dropped. The hit capsule is the avatar's own (AVATARS).
import { TransformNode, Vector3 } from '@babylonjs/core';
import type { AvatarId } from '@world/shared';
import { SkinnedBody, type SkinnedModel } from './skinned';
import type { Build, Figure } from './Walker';

export type BodyBone = 'body' | 'armL' | 'armR' | 'legL' | 'legR';
const PARENTS: Record<BodyBone, BodyBone | null> = {
  body: null,
  armL: 'body',
  armR: 'body',
  legL: 'body',
  legR: 'body',
};

// What tells one such avatar from another.
export interface BodySpec extends Pick<Figure, 'shadow' | 'legSwing' | 'armSwing' | 'armsDown' | 'bob' | 'sway'> {
  kind: AvatarId;
  model: SkinnedModel<BodyBone>;
  follow: number; // how much of the look's pitch the body tips by
  // Draw the inside of the model too: for one made of open shells, where a gap (under a chin, inside
  // a collar) looks into the back of another part rather than out the other side.
  doubleSided?: boolean;
}

const AIR_LEGS = 0.4; // radians the legs are held apart in the air
// Lying on its back: radians the legs and arms drop toward the ground.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;

export function bodyBuilder(spec: BodySpec): Build {
  const { kind, model, follow, doubleSided, ...walk } = spec;
  return (engine, id, base) => {
    const skin = new SkinnedBody(engine, `${kind}-${id}`, model, kind, PARENTS, base);
    const body = skin.node('body');
    const armR = skin.node('armR');
    if (doubleSided) {
      skin.material.backFaceCulling = false;
      skin.material.twoSidedLighting = true;
    }
    // A held item goes in the right palm; the flamethrower's tank hangs on the back.
    const grip = new TransformNode(`avatar-grip-${id}`, engine.scene);
    grip.parent = armR;
    grip.position.copyFrom(skin.offset('armR', model.hand));
    const reach = grip.position.normalizeToNew();
    return {
      ...walk,
      tilt: { node: body, follow },
      legs: [
        { node: skin.node('legL'), side: 1 },
        { node: skin.node('legR'), side: -1 },
      ],
      armL: { node: skin.node('armL'), reach: new Vector3(-reach.x, reach.y, reach.z) },
      armR: { node: armR, grip, reach },
      back: { node: body, at: skin.offset('body', model.back) },
      materials: [skin.material],
      airLegs: AIR_LEGS,
      lie: { onto: 'back', height: model.lie, legs: DEAD_LEGS, arms: DEAD_ARMS },
      dispose: () => skin.dispose(),
    };
  };
}
