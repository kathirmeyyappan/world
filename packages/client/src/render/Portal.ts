// The portal of light a dragon rises through: a glowing disc lying on the ground where it comes
// up, open while its body is still coming out, turning slowly, and fading shut once the tail is
// out. One per dragon; the light itself is drawn once and shared.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, type Vector3 } from '@babylonjs/core';
import type { Engine } from './Engine';

const ACROSS = 7; // metres
const FADE = 0.6; // seconds to open or shut
const TURN = 0.5; // radians a second

let light: DynamicTexture | null = null;

export class Portal {
  private readonly disc: Mesh;
  private readonly material: StandardMaterial;
  private open = 0; // 0 shut to 1 open

  constructor(engine: Engine, name: string) {
    const scene = engine.scene;
    this.disc = MeshBuilder.CreateDisc(name, { radius: ACROSS / 2, tessellation: 32 }, scene);
    this.disc.rotation.x = Math.PI / 2;
    this.disc.isPickable = false;
    this.material = new StandardMaterial(name, scene);
    const texture = (light ??= lightTexture(engine));
    this.material.diffuseTexture = texture;
    this.material.opacityTexture = texture;
    this.material.emissiveTexture = texture;
    this.material.emissiveColor = new Color3(1, 0.95, 0.75);
    this.material.disableLighting = true;
    this.material.backFaceCulling = false;
    this.disc.material = this.material;
    this.disc.setEnabled(false);
    engine.glowLayer.addIncludedOnlyMesh(this.disc);
  }

  // `at` is over where the body comes out (its x and z), `ground` the floor there, and `open`
  // whether any of the body is still down in it.
  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.open = Math.max(0, Math.min(1, this.open + ((open ? 1 : -1) * dt) / FADE));
    if (open) this.disc.position.set(at.x, ground + 0.04, at.z);
    this.disc.setEnabled(this.open > 0);
    this.material.alpha = this.open;
    this.disc.rotation.y += dt * TURN;
    this.disc.scaling.setAll(0.6 + 0.4 * this.open);
  }

  dispose(): void {
    this.disc.dispose();
    this.material.dispose(); // not its textures: the light is every portal's
  }
}

// Pale gold light: a soft disc with a brighter rim.
function lightTexture(engine: Engine): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture('portal-light', size, engine.scene, false, Texture.BILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,250,220,0.85)');
  g.addColorStop(0.55, 'rgba(255,230,150,0.45)');
  g.addColorStop(0.82, 'rgba(255,240,190,0.95)');
  g.addColorStop(0.9, 'rgba(255,215,120,0.6)');
  g.addColorStop(1, 'rgba(255,215,120,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
}
