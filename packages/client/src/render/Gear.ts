// Worn gear on an avatar's back (sim/gear.ts). The jetpack is two tanks on a frame with a nozzle
// under each, and a flame out of each nozzle while its wearer thrusts. One per avatar, owned by
// HeldItems beside the weapons; a new piece of gear is another case in buildGear.
import { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { GEAR_IDS, type GearId } from '@world/shared';
import type { Engine } from './Engine';
import { FlameJet } from './FlameJet';

type Scene = Engine['scene'];

const JET_LENGTH = 1.3; // metres of flame below each nozzle

export class WornGear {
  private readonly shapes = new Map<GearId, { node: TransformNode; depth: number }>();
  private readonly jets: FlameJet[] = [];
  private worn: GearId | null = null;

  constructor(engine: Engine, name: string, back: TransformNode, offset: Vector3) {
    const scene = engine.scene;
    for (const id of GEAR_IDS) {
      const node = new TransformNode(`${name}-${id}`, scene);
      node.parent = back;
      node.position.copyFrom(offset);
      const { depth, nozzles } = buildGear(scene, `${name}-${id}`, id, node);
      for (const [i, at] of nozzles.entries()) {
        const nozzle = new TransformNode(`${name}-${id}-nozzle-${i}`, scene);
        nozzle.parent = node;
        nozzle.position.copyFrom(at);
        nozzle.rotation.x = Math.PI / 2; // the jet runs along +z; this points it at the ground
        this.jets.push(new FlameJet(engine, `${name}-${id}-${i}`, nozzle, JET_LENGTH));
      }
      node.setEnabled(false);
      this.shapes.set(id, { node, depth });
    }
  }

  // Metres the worn piece stands out from the back, so a flamethrower tank can sit behind it.
  get depth(): number {
    return this.worn ? this.shapes.get(this.worn)!.depth : 0;
  }

  update(gear: GearId | null, thrusting: boolean, dt: number): void {
    if (gear !== this.worn) {
      if (this.worn) this.shapes.get(this.worn)!.node.setEnabled(false);
      if (gear) this.shapes.get(gear)!.node.setEnabled(true);
      this.worn = gear;
    }
    for (const jet of this.jets) {
      jet.set(thrusting && gear === 'jetpack');
      jet.update(dt);
    }
  }
}

// One piece's shape under `parent`, its back against the parent's origin and the rest behind it
// (-z). Returns how deep it is and where its nozzles are.
function buildGear(
  scene: Scene,
  name: string,
  id: GearId,
  parent: TransformNode,
): { depth: number; nozzles: Vector3[] } {
  const mat = (n: string, diffuse: Color3, emissive: Color3) => {
    const m = new StandardMaterial(`${name}-${n}`, scene);
    m.diffuseColor = diffuse;
    m.emissiveColor = emissive;
    m.specularColor = Color3.Black();
    return m;
  };
  const part = (n: string, w: number, h: number, d: number, m: StandardMaterial, x: number, y: number, z: number) => {
    const mesh = MeshBuilder.CreateBox(`${name}-${n}`, { width: w, height: h, depth: d }, scene);
    mesh.material = m;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
  };
  switch (id) {
    case 'jetpack': {
      const shell = mat('shell', new Color3(0.72, 0.74, 0.78), new Color3(0.16, 0.16, 0.18));
      const stripe = mat('stripe', new Color3(0.95, 0.72, 0.1), new Color3(0.25, 0.17, 0.02));
      const dark = mat('dark', new Color3(0.14, 0.15, 0.18), new Color3(0.04, 0.04, 0.05));
      part('frame', 0.46, 0.5, 0.06, dark, 0, 0, -0.03);
      for (const [side, x] of [
        ['L', -0.13],
        ['R', 0.13],
      ] as const) {
        part(`tank${side}`, 0.2, 0.56, 0.2, shell, x, 0.02, -0.16);
        part(`band${side}`, 0.21, 0.07, 0.21, stripe, x, 0.14, -0.16);
        part(`cap${side}`, 0.12, 0.06, 0.12, dark, x, 0.33, -0.16);
        part(`nozzle${side}`, 0.13, 0.1, 0.13, dark, x, -0.31, -0.16);
      }
      return {
        depth: 0.26,
        nozzles: [new Vector3(-0.13, -0.37, -0.16), new Vector3(0.13, -0.37, -0.16)],
      };
    }
  }
}
