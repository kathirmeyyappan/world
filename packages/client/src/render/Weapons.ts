// Weapon shapes and the first-person viewmodel. Each item has a blocky shape built from boxes;
// the same shape sits in the camera's bottom-right for the local player and in the right hand of
// other players' avatars. Recoil and muzzle flash are viewmodel-only.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Camera } from '@babylonjs/core';
import { ITEMS, ITEM_IDS, type ItemId } from '@world/shared';
import type { Engine } from './Engine';
import { FlameJet } from './FlameJet';

type Scene = Engine['scene'];

const REST = new Vector3(0.3, -0.24, 0.6);
const FLASH_SECONDS = 0.06;
const RECOIL_HALF_LIFE = 0.05;

interface Palette {
  metal: StandardMaterial;
  grip: StandardMaterial;
  tank: StandardMaterial;
  hose: StandardMaterial;
}

export function weaponPalette(scene: Scene, name: string): Palette {
  const mat = (n: string, diffuse: Color3, emissive = Color3.Black()) => {
    const m = new StandardMaterial(`${name}-${n}`, scene);
    m.diffuseColor = diffuse;
    m.emissiveColor = emissive;
    m.specularColor = Color3.Black();
    return m;
  };
  return {
    metal: mat('metal', new Color3(0.16, 0.17, 0.2), new Color3(0.05, 0.05, 0.07)),
    grip: mat('grip', new Color3(0.3, 0.18, 0.12)),
    tank: mat('tank', new Color3(0.62, 0.12, 0.1), new Color3(0.12, 0.02, 0.02)),
    hose: mat('hose', new Color3(0.1, 0.1, 0.12)),
  };
}

// Builds one item's shape under `parent`. Returns where the muzzle is, for the flash.
export function buildWeapon(scene: Scene, name: string, id: ItemId, parent: TransformNode, pal: Palette): Vector3 {
  const part = (n: string, w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
    const m = MeshBuilder.CreateBox(`${name}-${n}`, { width: w, height: h, depth: d }, scene);
    m.material = mat;
    m.parent = parent;
    m.position.set(x, y, z);
    m.isPickable = false;
    return m;
  };
  switch (id) {
    case 'gun':
      part('slide', 0.07, 0.07, 0.3, pal.metal, 0, 0.03, 0.15);
      part('barrel', 0.035, 0.035, 0.08, pal.metal, 0, 0.035, 0.33);
      part('grip', 0.06, 0.13, 0.07, pal.grip, 0, -0.06, 0.02);
      part('trigger', 0.03, 0.04, 0.03, pal.metal, 0, -0.02, 0.1);
      return new Vector3(0, 0.035, 0.38);
    case 'sniper':
      part('body', 0.07, 0.08, 0.5, pal.metal, 0, 0.03, 0.2);
      part('barrel', 0.035, 0.035, 0.45, pal.metal, 0, 0.045, 0.65);
      part('scope', 0.05, 0.05, 0.22, pal.metal, 0, 0.11, 0.18);
      part('stock', 0.06, 0.1, 0.22, pal.grip, 0, -0.01, -0.15);
      part('grip', 0.06, 0.12, 0.06, pal.grip, 0, -0.07, 0.02);
      return new Vector3(0, 0.045, 0.9);
    case 'flamethrower':
      // The wand: a fat tube with a flared nozzle, a grip, and a hose running back to the tank.
      part('tube', 0.09, 0.09, 0.42, pal.metal, 0, 0.03, 0.18);
      part('nozzle', 0.13, 0.13, 0.1, pal.tank, 0, 0.03, 0.42);
      part('pilot', 0.05, 0.05, 0.04, pal.grip, 0, 0.03, 0.49);
      part('grip', 0.06, 0.13, 0.07, pal.grip, 0, -0.06, 0.02);
      part('hose1', 0.05, 0.05, 0.16, pal.hose, 0, 0.03, -0.1);
      part('hose2', 0.05, 0.14, 0.05, pal.hose, 0, -0.03, -0.2);
      return new Vector3(0, 0.03, 0.5);
  }
}

// The flamethrower's backpack: two tanks and a frame, worn on the back while holding it.
export function buildTank(scene: Scene, name: string, parent: TransformNode, pal: Palette): TransformNode {
  const node = new TransformNode(`${name}-tank`, scene);
  node.parent = parent;
  const part = (n: string, w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
    const m = MeshBuilder.CreateBox(`${name}-tank-${n}`, { width: w, height: h, depth: d }, scene);
    m.material = mat;
    m.parent = node;
    m.position.set(x, y, z);
    m.isPickable = false;
  };
  part('left', 0.18, 0.62, 0.18, pal.tank, -0.12, 0, 0);
  part('right', 0.18, 0.62, 0.18, pal.tank, 0.12, 0, 0);
  part('capL', 0.1, 0.06, 0.1, pal.metal, -0.12, 0.34, 0);
  part('capR', 0.1, 0.06, 0.1, pal.metal, 0.12, 0.34, 0);
  part('frame', 0.44, 0.08, 0.06, pal.metal, 0, -0.2, -0.1);
  part('hose', 0.05, 0.05, 0.2, pal.hose, 0.16, -0.25, 0.1);
  return node;
}

export class Viewmodel {
  private readonly root: TransformNode;
  private readonly shapes = new Map<ItemId, { node: TransformNode; flash: Mesh }>();
  private readonly jet!: FlameJet; // assigned in the loop below, for the flamethrower
  private current: ItemId | null = null;
  private recoil = 0;
  private flashLeft = 0;

  constructor(engine: Engine, camera: Camera) {
    const scene = engine.scene;
    this.root = new TransformNode('viewmodel', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(REST);
    this.root.scaling.setAll(0.75);

    const pal = weaponPalette(scene, 'viewmodel');
    const flashMat = new StandardMaterial('viewmodel-flash', scene);
    flashMat.emissiveColor = new Color3(1, 0.85, 0.4);
    flashMat.disableLighting = true;
    for (const id of ITEM_IDS) {
      const node = new TransformNode(`viewmodel-${id}`, scene);
      node.parent = this.root;
      const muzzle = buildWeapon(scene, `viewmodel-${id}`, id, node, pal);
      if (id === 'flamethrower') {
        const nozzle = new TransformNode('viewmodel-nozzle', scene);
        nozzle.parent = node;
        nozzle.position.copyFrom(muzzle);
        // The root is scaled down, so the jet is stretched to still reach the item's range.
        this.jet = new FlameJet(engine, 'viewmodel', nozzle, ITEMS.flamethrower.range / 0.75);
      }
      const flash = MeshBuilder.CreateBox(`viewmodel-${id}-flash`, { size: 0.09 }, scene);
      flash.material = flashMat;
      flash.parent = node;
      flash.position.copyFrom(muzzle);
      flash.isPickable = false;
      flash.applyFog = false;
      flash.setEnabled(false);
      engine.glowLayer.addIncludedOnlyMesh(flash);
      node.setEnabled(false);
      this.shapes.set(id, { node, flash });
    }
  }

  // Show this item (or nothing). Hidden while scoped: the scope overlay is the view.
  show(id: ItemId | null): void {
    if (id === this.current) return;
    if (this.current) this.shapes.get(this.current)!.node.setEnabled(false);
    if (id) this.shapes.get(id)!.node.setEnabled(true);
    this.current = id;
  }

  // Hold weapons: the jet is on while the sim says we're firing.
  setFiring(on: boolean): void {
    this.jet.set(on && this.current === 'flamethrower');
  }

  fire(): void {
    if (!this.current) return;
    this.recoil = 1;
    this.flashLeft = FLASH_SECONDS;
    const flash = this.shapes.get(this.current)!.flash;
    flash.setEnabled(true);
    flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number): void {
    this.jet.update(dt);
    if (this.recoil > 0) {
      this.recoil *= Math.pow(0.5, dt / RECOIL_HALF_LIFE);
      if (this.recoil < 0.01) this.recoil = 0;
      this.root.position.set(REST.x, REST.y + this.recoil * 0.03, REST.z - this.recoil * 0.08);
      this.root.rotation.x = -this.recoil * 0.25;
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      if (this.flashLeft <= 0) for (const s of this.shapes.values()) s.flash.setEnabled(false);
    }
  }
}
