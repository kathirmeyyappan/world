// Tints an avatar's materials red for a moment when it takes a hit. Time-based rather than
// frame-based so it looks the same at any frame rate; the avatar calls update() from its own
// per-frame update.
import { Color3, type StandardMaterial } from '@babylonjs/core';

const FLASH_MS = 140;
const FLASH_COLOR = new Color3(1, 0.12, 0.16);

export class HitFlash {
  private readonly originals: { mat: StandardMaterial; diffuse: Color3; emissive: Color3 }[];
  private until = 0;
  private lit = false;

  constructor(materials: StandardMaterial[]) {
    this.originals = materials.map((mat) => ({
      mat,
      diffuse: mat.diffuseColor.clone(),
      emissive: mat.emissiveColor.clone(),
    }));
  }

  trigger(): void {
    this.until = performance.now() + FLASH_MS;
    if (this.lit) return;
    this.lit = true;
    for (const { mat } of this.originals) {
      mat.diffuseColor = FLASH_COLOR;
      mat.emissiveColor = FLASH_COLOR.scale(0.6);
    }
  }

  update(): void {
    if (!this.lit || performance.now() < this.until) return;
    this.lit = false;
    for (const { mat, diffuse, emissive } of this.originals) {
      mat.diffuseColor = diffuse;
      mat.emissiveColor = emissive;
    }
  }
}
