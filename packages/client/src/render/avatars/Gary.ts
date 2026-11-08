// Gary, SpongeBob's snail: a soft body with a foot along its underside, a shell on his back and
// his eyes on stalks at the front, from Anthony Yanez's model (garyModel.ts, made by
// scripts/avatar-model.py) and skinned over a handful of bones. He has no arms or legs, so nothing
// holds an item: it sits by the right of his eyes, aimed along the look, and his packs hang upright
// on the back of his shell. He glides along with no footsteps, and dies rolled onto his right side.
import { TransformNode, Vector3 } from '@babylonjs/core';
import type { Engine } from '../Engine';
import { GARY_MODEL } from './garyModel';
import { SkinnedBody } from './skinned';
import type { Figure } from './Walker';

type GaryBone = 'body' | 'shell' | 'eyes';
const PARENTS: Record<GaryBone, GaryBone | null> = { body: null, shell: 'body', eyes: 'body' };

// How much of the look's pitch the eyes take; a held item takes the rest, so it still aims along the look.
const FOLLOW = 0.5;
// The weapon's grip in the eyes' frame, metres: beside the right eye and a little in front of it.
const GRIP = new Vector3(0.14, -0.02, 0.1);
// Drawn this much of their size, to fit his body: the guns and the packs were made for a person.
const WEAPON_SCALE = 0.6;
const PACK_SCALE = 0.5;

export function buildGary(engine: Engine, id: string, base: TransformNode): Figure {
  const scene = engine.scene;
  const skin = new SkinnedBody(engine, `gary-${id}`, GARY_MODEL, 'gary', PARENTS, base);
  const eyes = skin.node('eyes');
  const side = skin.mesh.getBoundingInfo().boundingBox.maximum.x; // metres from his middle out to his right side: how high he lies on it
  // The foot and stalks are open sheets in the model, so they are drawn from both sides.
  skin.material.backFaceCulling = false;
  skin.material.twoSidedLighting = true;

  // The item's hand is a point by the eyes that turns to the look, with the grip on it.
  const hand = new TransformNode(`avatar-hand-${id}`, scene);
  hand.parent = eyes;
  hand.position.copyFrom(GRIP);
  const grip = new TransformNode(`avatar-grip-${id}`, scene);
  grip.parent = hand;

  return {
    tilt: { node: eyes, follow: FOLLOW },
    armR: { node: hand, grip, reach: Vector3.Down() },
    // The packs hang off the shell, which never moves, so they stay put on its back as he crawls.
    back: { node: skin.node('shell'), at: skin.offset('shell', GARY_MODEL.back) },
    materials: [skin.material],
    shadow: 0.7,
    itemScale: { weapons: WEAPON_SCALE, packs: PACK_SCALE },
    legSwing: 0,
    airLegs: 0,
    armSwing: 0,
    bob: 0,
    // Rolled onto his right side about his length, lifted so that side rests on the ground, the
    // item lying level along his body rather than through the ground.
    lie: { onto: 'right', height: side, arms: -Math.PI / 2 },
    dispose: () => skin.dispose(),
  };
}
