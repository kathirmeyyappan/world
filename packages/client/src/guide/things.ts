// What the guide's item views show: each item on its own, floating and turning as a pickup does in
// the world (sim/pickups.ts), and each résumé cube floating as the cubes do (sim/cubes.ts), built
// from the shapes the game draws them with.
import { TransformNode } from '@babylonjs/core';
import {
  CUBE_BASE_Y,
  CUBE_FLOAT_AMPLITUDE,
  ITEMS,
  PICKUPS,
  PICKUP_BOB,
  PICKUP_BOB_HZ,
  PICKUP_SPIN,
  type CubeContent,
  type GearId,
  type ItemId,
  type PickupKind,
} from '@world/shared';
import type { Thing } from '../render/BodyView';
import { CubeMesh } from '../render/CubeMesh';
import { buildGear } from '../render/Gear';
import { buildHeart } from '../render/Pickups';
import { buildTank, buildWeapon, weaponPalette } from '../render/Weapons';

const HOVER = 1.2; // metres up an item floats over the floor, about where it's held
const BIG = 2; // a big heart is the heart at twice the size (render/Pickups.ts)
// A cube's float and turn: the middle of the ranges the sim draws each cube's from.
const CUBE_FLOAT_HZ = 1.5;
const CUBE_TURN = 0.35;

// Floats `node` up and down and turns it, as a pickup does, `t` seconds in.
function float(node: TransformNode, height: number, t: number): void {
  node.position.y = height + Math.sin(t * PICKUP_BOB_HZ * 2 * Math.PI) * PICKUP_BOB;
  node.rotation.y = t * PICKUP_SPIN;
}

export function itemThing(id: ItemId): Thing {
  return {
    key: `item-${id}`,
    build(engine, parent) {
      const scene = engine.scene;
      const pal = weaponPalette(scene, `guide-${id}`);
      const item = new TransformNode(`guide-${id}-item`, scene);
      item.parent = parent;
      buildWeapon(scene, `guide-${id}`, id, item, pal);
      // A hold weapon's tank floats beside it, as it hangs on the back of whoever holds it.
      const element = ITEMS[id].element;
      if (element) buildTank(scene, `guide-${id}`, item, pal, element).position.set(-0.35, 0, 0.1);
      return (t) => float(item, HOVER, t);
    },
  };
}

export function gearThing(id: GearId): Thing {
  return {
    key: `gear-${id}`,
    build(engine, parent) {
      const node = new TransformNode(`guide-${id}`, engine.scene);
      node.parent = parent;
      const piece = new TransformNode(`guide-${id}-piece`, engine.scene);
      piece.parent = node;
      const { depth } = buildGear(engine.scene, `guide-${id}`, id, piece);
      piece.position.z = depth / 2; // built with its back at its origin: turned about its middle
      return (t) => float(node, HOVER, t);
    },
  };
}

export function pickupThing(kind: PickupKind): Thing {
  const scale = kind === 'big-heart' ? BIG : 1;
  const height = PICKUPS[kind].height;
  return {
    key: `pickup-${kind}`,
    build(engine, parent) {
      const heart = buildHeart(engine);
      heart.setEnabled(true); // the shape the world draws copies of, drawn itself here
      // Seen from across the world its glow is a halo; this close it would wash the heart out white.
      engine.glowLayer.addExcludedMesh(heart);
      heart.parent = parent;
      heart.scaling.setAll(scale);
      return (t) => float(heart, height, t);
    },
  };
}

export function cubeThing(content: CubeContent): Thing {
  return {
    key: `cube-${content.id}`,
    build(engine, parent) {
      const cube = new CubeMesh(engine, content);
      cube.mesh.parent = parent;
      parent.onDisposeObservable.add(() => cube.dispose());
      return (t) =>
        cube.update({
          id: content.id,
          x: 0,
          y: CUBE_BASE_Y + Math.sin(t * CUBE_FLOAT_HZ) * CUBE_FLOAT_AMPLITUDE,
          z: 0,
          rx: Math.sin(t * 0.5) * 0.1,
          ry: t * CUBE_TURN,
        });
    },
  };
}
