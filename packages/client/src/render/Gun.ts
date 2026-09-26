// The first-person pistol: a few boxes parented to the camera, bottom right, with a recoil kick
// and a muzzle flash when fired. Other players' guns live in Avatar.ts.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Camera } from '@babylonjs/core';
import type { Engine } from './Engine';

const REST = new Vector3(0.3, -0.24, 0.6);
const FLASH_SECONDS = 0.06;
const RECOIL_HALF_LIFE = 0.05;

export class Gun {
  private readonly root: TransformNode;
  private readonly flash: Mesh;
  private recoil = 0;
  private flashLeft = 0;

  constructor(engine: Engine, camera: Camera) {
    const scene = engine.scene;
    this.root = new TransformNode('gun', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(REST);
    this.root.scaling.setAll(0.75);

    const metal = new StandardMaterial('gun-metal', scene);
    metal.diffuseColor = new Color3(0.16, 0.17, 0.2);
    metal.emissiveColor = new Color3(0.05, 0.05, 0.07);
    metal.specularColor = Color3.Black();
    const grip = new StandardMaterial('gun-grip', scene);
    grip.diffuseColor = new Color3(0.3, 0.18, 0.12);
    grip.specularColor = Color3.Black();

    pistol(scene, 'gun', this.root, metal, grip);

    const flashMat = new StandardMaterial('gun-flash', scene);
    flashMat.emissiveColor = new Color3(1, 0.85, 0.4);
    flashMat.disableLighting = true;
    this.flash = MeshBuilder.CreateBox('gun-flash', { size: 0.09 }, scene);
    this.flash.material = flashMat;
    this.flash.parent = this.root;
    this.flash.position.set(0, 0.03, 0.36);
    this.flash.isPickable = false;
    this.flash.applyFog = false;
    this.flash.setEnabled(false);
    engine.glowLayer.addIncludedOnlyMesh(this.flash);

    this.root.setEnabled(false);
  }

  setVisible(visible: boolean): void {
    if (this.root.isEnabled() !== visible) this.root.setEnabled(visible);
  }

  fire(): void {
    this.recoil = 1;
    this.flashLeft = FLASH_SECONDS;
    this.flash.setEnabled(true);
    this.flash.rotation.z = Math.random() * Math.PI;
  }

  update(dt: number): void {
    if (this.recoil > 0) {
      this.recoil *= Math.pow(0.5, dt / RECOIL_HALF_LIFE);
      if (this.recoil < 0.01) this.recoil = 0;
      this.root.position.set(REST.x, REST.y + this.recoil * 0.03, REST.z - this.recoil * 0.08);
      this.root.rotation.x = -this.recoil * 0.25;
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      if (this.flashLeft <= 0) this.flash.setEnabled(false);
    }
  }
}

// Shared pistol shape: slide/barrel along +z, a grip hanging down at the back. Used for the
// viewmodel and for guns in avatars' hands.
export function pistol(scene: Engine['scene'], name: string, parent: TransformNode, metal: StandardMaterial, grip: StandardMaterial): Mesh[] {
  const part = (n: string, w: number, h: number, d: number, mat: StandardMaterial, x: number, y: number, z: number) => {
    const m = MeshBuilder.CreateBox(`${name}-${n}`, { width: w, height: h, depth: d }, scene);
    m.material = mat;
    m.parent = parent;
    m.position.set(x, y, z);
    m.isPickable = false;
    return m;
  };
  return [
    part('slide', 0.07, 0.07, 0.3, metal, 0, 0.03, 0.15),
    part('barrel', 0.035, 0.035, 0.08, metal, 0, 0.035, 0.33),
    part('grip', 0.06, 0.13, 0.07, grip, 0, -0.06, 0.02),
    part('trigger', 0.03, 0.04, 0.03, metal, 0, -0.02, 0.1),
  ];
}
