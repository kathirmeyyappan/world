// Tints an avatar's materials: red for a moment when it takes a hit, and frosted over for as long as
// it is frozen (an ice hit, sim/constants.ts), dimmed and blued under a crust of ice crystals.
// Time-based rather than frame-based so it looks the same at any frame rate; the avatar calls
// update() from its own per-frame update with whether its player is frozen. A material that glows
// through a texture glows plain red, or with the crystals, for the while.
import { Color3, DynamicTexture, Texture, type BaseTexture, type Scene, type StandardMaterial } from '@babylonjs/core';

const FLASH_MS = 140;
const FLASH_COLOR = new Color3(1, 0.12, 0.16);
const FROST_TINT = new Color3(0.45, 0.62, 0.85); // over the diffuse colour, texture and all: dimmed and blued
const BLACK = Color3.Black();
// Pixels across the crystal pattern, which repeats FROST_TILES times over a texture's space: across
// each face of a box body, and across a skinned one's whole atlas, where a fern is the size of a
// hand.
const FROST_SIZE = 64;
const FROST_TILES = 3;

export class HitFlash {
  private readonly originals: {
    mat: StandardMaterial;
    diffuse: Color3;
    emissive: Color3;
    emissiveTexture: BaseTexture | null;
    illumination: boolean;
  }[];
  private until = 0;
  private lit = false;
  private frozen = false;

  constructor(materials: StandardMaterial[]) {
    this.originals = materials.map((mat) => ({
      mat,
      diffuse: mat.diffuseColor.clone(),
      emissive: mat.emissiveColor.clone(),
      emissiveTexture: mat.emissiveTexture,
      illumination: mat.useEmissiveAsIllumination,
    }));
  }

  trigger(): void {
    this.until = performance.now() + FLASH_MS;
    if (this.lit) return;
    this.lit = true;
    for (const { mat } of this.originals) {
      mat.diffuseColor = FLASH_COLOR;
      mat.emissiveColor = FLASH_COLOR.scale(0.6);
      mat.emissiveTexture = null;
      mat.useEmissiveAsIllumination = false;
    }
  }

  update(frozen = false): void {
    const changed = frozen !== this.frozen;
    this.frozen = frozen;
    if (this.lit) {
      if (performance.now() < this.until) return;
      this.lit = false;
    } else if (!changed) return;
    this.paint();
  }

  // The look under the flash: frosted over, or its own. The crystals are laid over the body as
  // light of their own; an emissive texture is otherwise shaded by the diffuse texture under it.
  private paint(): void {
    if (!this.originals.length) return;
    const frost = this.frozen ? frostTexture(this.originals[0].mat.getScene()) : null;
    for (const { mat, diffuse, emissive, emissiveTexture, illumination } of this.originals) {
      mat.diffuseColor = frost ? FROST_TINT : diffuse;
      mat.emissiveColor = frost ? BLACK : emissive;
      mat.emissiveTexture = frost ?? emissiveTexture;
      mat.useEmissiveAsIllumination = frost ? true : illumination;
    }
  }
}

const frostTextures = new WeakMap<Scene, DynamicTexture>();

// The crystals: ferns of white and pale blue pixels on black, drawn once per scene and wrapping at
// the edges so they tile. Laid over a body as light, the black adds nothing: only the crystals show.
function frostTexture(scene: Scene): DynamicTexture {
  let tex = frostTextures.get(scene);
  if (tex) return tex;
  tex = new DynamicTexture('frost', FROST_SIZE, scene, false, Texture.NEAREST_SAMPLINGMODE);
  tex.uScale = tex.vScale = FROST_TILES;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, FROST_SIZE, FROST_SIZE);
  const wrap = (v: number) => ((Math.round(v) % FROST_SIZE) + FROST_SIZE) % FROST_SIZE;
  // A pixel, or a `size` pixel square, of the bright white or the paler blue.
  const dot = (x: number, y: number, bright: boolean, size = 1) => {
    ctx.fillStyle = bright ? '#eef8ff' : '#8ec6ff';
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) ctx.fillRect(wrap(x + i), wrap(y + j), 1, 1);
  };
  // A fern: a bright vein `length` pixels long from (x, y) along `angle`, with a paler branch off
  // each side every few pixels; then a scatter of lone crystals.
  const fern = (x: number, y: number, angle: number, length: number) => {
    for (let i = 0; i < length; i++) {
      const vx = x + Math.cos(angle) * i;
      const vy = y + Math.sin(angle) * i;
      dot(vx, vy, true);
      if (i % 4 !== 2) continue;
      for (const side of [-1, 1]) {
        const a = angle + (side * Math.PI) / 3;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let j = 1; j <= n; j++) dot(vx + Math.cos(a) * j, vy + Math.sin(a) * j, false);
      }
    }
  };
  for (let k = 0; k < 10; k++) {
    fern(Math.random() * FROST_SIZE, Math.random() * FROST_SIZE, Math.random() * Math.PI * 2, 10 + Math.random() * 14);
  }
  for (let k = 0; k < 130; k++)
    dot(Math.random() * FROST_SIZE, Math.random() * FROST_SIZE, Math.random() < 0.4, Math.random() < 0.2 ? 2 : 1);
  tex.update();
  frostTextures.set(scene, tex);
  return tex;
}
