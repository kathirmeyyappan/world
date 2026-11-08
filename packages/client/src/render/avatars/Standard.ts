// The standard avatar: a blocky figure in the player's colour with a glowing visor. No outline
// pass: thin lines shimmer at the reduced render resolution.
import { Color3, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT } from '@world/shared';
import type { Engine } from '../Engine';
import { box } from './common';
import type { Figure } from './Walker';

export function buildStandard(engine: Engine, id: string, base: TransformNode, color: string): Figure {
  const scene = engine.scene;
  const c = Color3.FromHexString(color);
  const suit = new StandardMaterial(`avatar-suit-${id}`, scene);
  suit.diffuseColor = c.scale(0.7);
  suit.emissiveColor = c.scale(0.22);
  suit.specularColor = Color3.Black();
  const skin = new StandardMaterial(`avatar-skin-${id}`, scene);
  skin.diffuseColor = c.scale(0.95);
  skin.emissiveColor = c.scale(0.3);
  skin.specularColor = Color3.Black();
  const visorMat = new StandardMaterial(`avatar-visor-${id}`, scene);
  visorMat.diffuseColor = Color3.Black();
  visorMat.emissiveColor = c;
  visorMat.disableLighting = true;

  const legL = box(scene, `avatar-legL-${id}`, 0.22, 0.7, 0.24, suit, base);
  const legR = box(scene, `avatar-legR-${id}`, 0.22, 0.7, 0.24, suit, base);
  legL.position.set(-0.14, 0.35, 0);
  legR.position.set(0.14, 0.35, 0);
  legL.setPivotPoint(new Vector3(0, 0.35, 0));
  legR.setPivotPoint(new Vector3(0, 0.35, 0));

  const torso = box(scene, `avatar-torso-${id}`, 0.58, 0.72, 0.34, suit, base);
  torso.position.y = 1.06;

  const armL = box(scene, `avatar-armL-${id}`, 0.17, 0.62, 0.2, skin, base);
  const armR = box(scene, `avatar-armR-${id}`, 0.17, 0.62, 0.2, skin, base);
  armL.position.set(-0.41, 1.08, 0);
  armR.position.set(0.41, 1.08, 0);
  armL.setPivotPoint(new Vector3(0, 0.31, 0));
  armR.setPivotPoint(new Vector3(0, 0.31, 0));

  const head = new TransformNode(`avatar-head-${id}`, scene);
  head.parent = base;
  head.position.y = EYE_HEIGHT - 0.02;
  const skull = box(scene, `avatar-skull-${id}`, 0.46, 0.46, 0.46, skin, head);
  skull.position.y = 0;
  const visor = box(scene, `avatar-visorMesh-${id}`, 0.4, 0.1, 0.06, visorMat, head);
  visor.position.set(0, 0.04, 0.23);
  engine.glowLayer.addIncludedOnlyMesh(visor);

  // Items go in the right hand; the flamethrower's tank sits on the back of the torso.
  const grip = new TransformNode(`avatar-grip-${id}`, scene);
  grip.parent = armR;
  grip.position.set(0, -0.32, 0.04);

  return {
    color,
    tilt: { node: head, follow: 0.6 },
    head,
    legs: [
      { node: legL, side: 1 },
      { node: legR, side: -1 },
    ],
    armL: { node: armL, reach: Vector3.Down() },
    armR: { node: armR, grip, reach: Vector3.Down() },
    back: { node: base, at: new Vector3(0, 1.12, -0.28) },
    materials: [suit, skin],
    shadow: 1.1,
    legSwing: 0.7,
    airLegs: 0.35,
    armSwing: 0.56,
    bob: 0.04,
    lie: { onto: 'left', height: 0.3, shift: 0.3 }, // tipped onto its side, limbs as they are
  };
}
