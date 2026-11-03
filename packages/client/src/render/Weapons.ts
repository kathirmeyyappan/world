// Weapon shapes and the first-person viewmodel. Each item has a blocky shape built from boxes;
// the same shape sits in the camera's bottom-right for the local player and in the right hand of
// other players' avatars. Recoil and muzzle flash are viewmodel-only.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Camera } from '@babylonjs/core';
import { ITEMS, ITEM_IDS, type AvatarId, type Element, type ItemId } from '@world/shared';
import type { Engine } from './Engine';
import { coneAngle, createJet, type Jet } from './Jet';

type Scene = Engine['scene'];

const REST = new Vector3(0.3, -0.24, 0.6);
// How an avatar holds a weapon: rolled this far about its barrel, in its hand and in its wearer's
// viewmodel alike. Tung holds the gun on its side, gangsta style; everything else sits upright.
const HOLD_ROLL: Partial<Record<AvatarId, Partial<Record<ItemId, number>>>> = {
  sahur: { gun: Math.PI / 2 },
};

export function holdRoll(avatar: AvatarId, item: ItemId): number {
  return HOLD_ROLL[avatar]?.[item] ?? 0;
}
const SCALE = 0.75; // the viewmodel's size, drawn under the camera
export const FLASH_SECONDS = 0.06;
const RECOIL_HALF_LIFE = 0.05;

interface Palette {
  metal: StandardMaterial;
  grip: StandardMaterial;
  hose: StandardMaterial;
  tanks: Record<Element, StandardMaterial>; // a hold weapon's tank and nozzle, in its element's colour
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
    hose: mat('hose', new Color3(0.1, 0.1, 0.12)),
    tanks: {
      fire: mat('tank-fire', new Color3(0.62, 0.12, 0.1), new Color3(0.12, 0.02, 0.02)),
      ice: mat('tank-ice', new Color3(0.6, 0.82, 0.95), new Color3(0.12, 0.2, 0.26)),
    },
  };
}

// Builds one item's shape under `parent`. Returns where the muzzle is, for the flash; null for an
// item no hand holds (a look's own).
export function buildWeapon(
  scene: Scene,
  name: string,
  id: ItemId,
  parent: TransformNode,
  pal: Palette,
): Vector3 | null {
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
    case 'ice-blower': {
      // The wand: a fat tube with a flared nozzle in its tank's colour, a grip, and a hose running
      // back to the tank; a pilot light at the flamethrower's tip, a frosted collar round the ice
      // blower's tube.
      const tank = pal.tanks[ITEMS[id].element!];
      part('tube', 0.09, 0.09, 0.42, pal.metal, 0, 0.03, 0.18);
      part('nozzle', 0.13, 0.13, 0.1, tank, 0, 0.03, 0.42);
      if (id === 'flamethrower') part('pilot', 0.05, 0.05, 0.04, pal.grip, 0, 0.03, 0.49);
      else part('collar', 0.12, 0.12, 0.07, tank, 0, 0.03, 0.2);
      part('grip', 0.06, 0.13, 0.07, pal.grip, 0, -0.06, 0.02);
      part('hose1', 0.05, 0.05, 0.16, pal.hose, 0, 0.03, -0.1);
      part('hose2', 0.05, 0.14, 0.05, pal.hose, 0, -0.03, -0.2);
      return new Vector3(0, 0.03, 0.5);
    }
    case 'firebreath':
      return null;
  }
}

// A hold weapon's backpack: two tanks in its element's colour and a frame, worn on the back while
// holding it.
export function buildTank(
  scene: Scene,
  name: string,
  parent: TransformNode,
  pal: Palette,
  element: Element,
): TransformNode {
  const node = new TransformNode(`${name}-tank`, scene);
  node.parent = parent;
  const part = (n: string, w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
    const m = MeshBuilder.CreateBox(`${name}-tank-${n}`, { width: w, height: h, depth: d }, scene);
    m.material = mat;
    m.parent = node;
    m.position.set(x, y, z);
    m.isPickable = false;
  };
  part('left', 0.18, 0.62, 0.18, pal.tanks[element], -0.12, 0, 0);
  part('right', 0.18, 0.62, 0.18, pal.tanks[element], 0.12, 0, 0);
  part('capL', 0.1, 0.06, 0.1, pal.metal, -0.12, 0.34, 0);
  part('capR', 0.1, 0.06, 0.1, pal.metal, 0.12, 0.34, 0);
  part('frame', 0.44, 0.08, 0.06, pal.metal, 0, -0.2, -0.1);
  part('hose', 0.05, 0.05, 0.2, pal.hose, 0.16, -0.25, 0.1);
  return node;
}

const flashMaterials = new WeakMap<Scene, StandardMaterial>();

// A muzzle flash: a small glowing cube at `muzzle` under `parent`, off until a shot.
export function buildFlash(engine: Engine, name: string, parent: TransformNode, muzzle: Vector3): Mesh {
  const scene = engine.scene;
  let material = flashMaterials.get(scene);
  if (!material) {
    material = new StandardMaterial('muzzle-flash', scene);
    material.emissiveColor = new Color3(1, 0.85, 0.4);
    material.disableLighting = true;
    flashMaterials.set(scene, material);
  }
  const flash = MeshBuilder.CreateBox(`${name}-flash`, { size: 0.09 }, scene);
  flash.material = material;
  flash.parent = parent;
  flash.position.copyFrom(muzzle);
  flash.isPickable = false;
  flash.applyFog = false;
  flash.setEnabled(false);
  engine.glowLayer.addIncludedOnlyMesh(flash);
  return flash;
}

export class Viewmodel {
  private readonly root: TransformNode;
  private readonly shapes = new Map<ItemId, { node: TransformNode; flash: Mesh; jet: Jet | null }>();
  private current: ItemId | null = null;
  private recoil = 0;
  private flashLeft = 0;

  constructor(engine: Engine, camera: Camera) {
    const scene = engine.scene;
    this.root = new TransformNode('viewmodel', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(REST);
    this.root.scaling.setAll(SCALE);

    const pal = weaponPalette(scene, 'viewmodel');
    for (const id of ITEM_IDS) {
      const node = new TransformNode(`viewmodel-${id}`, scene);
      node.parent = this.root;
      const muzzle = buildWeapon(scene, `viewmodel-${id}`, id, node, pal);
      if (!muzzle) {
        node.dispose();
        continue;
      }
      const spec = ITEMS[id];
      let jet: Jet | null = null;
      if (spec.element) {
        const nozzle = new TransformNode(`viewmodel-${id}-nozzle`, scene);
        nozzle.parent = node;
        nozzle.position.copyFrom(muzzle);
        // The root is scaled down, so the jet is stretched to still reach the item's range.
        jet = createJet(engine, `viewmodel-${id}`, nozzle, spec.element, spec.range / SCALE, coneAngle(spec));
      }
      const flash = buildFlash(engine, `viewmodel-${id}`, node, muzzle);
      node.setEnabled(false);
      this.shapes.set(id, { node, flash, jet });
    }
  }

  // Show this item (or nothing), held as `avatar` holds it. Hidden while scoped: the scope overlay is
  // the view; an item with no shape in hand shows as nothing.
  show(id: ItemId | null, avatar: AvatarId): void {
    if (id && !this.shapes.has(id)) id = null;
    if (id) this.shapes.get(id)!.node.rotation.z = holdRoll(avatar, id);
    if (id === this.current) return;
    if (this.current) this.shapes.get(this.current)!.node.setEnabled(false);
    if (id) this.shapes.get(id)!.node.setEnabled(true);
    this.current = id;
  }

  // Hold weapons: the held one's jet is on while the sim says we're firing.
  setFiring(on: boolean): void {
    for (const [id, s] of this.shapes) s.jet?.set(on && id === this.current);
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
    for (const s of this.shapes.values()) s.jet?.update(dt);
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
