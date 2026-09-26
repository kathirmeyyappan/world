// Visual for one info cube. Position and rotation come from the server every frame. Cubes are
// neutral: a pale frame and a logo downsampled to a coarse pixel grid. Hover and "being read"
// change the frame only, so the logo stays readable.
import { Color3, DynamicTexture, FresnelParameters, Mesh, MeshBuilder, StandardMaterial, Texture } from '@babylonjs/core';
import type { CubeContent, CubeSnapshot } from '@world/shared';
import { createShadowBlob } from './Avatar';
import type { Engine } from './Engine';
import { loadPixelated } from './pixelate';

const SIZE = 1.8;
export const LOGO_PIXELS = 40;
const FRAME_IDLE = new Color3(0.75, 0.78, 0.85);
const FRAME_HOT = new Color3(1, 1, 1);
const FRAME_READ = new Color3(0.55, 0.6, 0.7);

export class CubeMesh {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly fresnel: FresnelParameters;
  private readonly shadow: Mesh;
  private hovered = false;
  private readers = 0;

  constructor(engine: Engine, readonly content: CubeContent) {
    const scene = engine.scene;
    this.mesh = MeshBuilder.CreateBox(`cube-${content.id}`, { size: SIZE, wrap: true }, scene);
    this.material = new StandardMaterial(`mat-${content.id}`, scene);
    this.material.diffuseColor = new Color3(0.9, 0.9, 0.95);
    this.material.emissiveColor = new Color3(0.35, 0.35, 0.4);
    this.material.specularColor = new Color3(0.1, 0.1, 0.1);
    this.material.specularPower = 24;
    if (content.logo) {
      const tex = new DynamicTexture(`logo-${content.id}`, { width: LOGO_PIXELS, height: LOGO_PIXELS }, scene, false, Texture.NEAREST_NEAREST_MIPLINEAR);
      tex.hasAlpha = false;
      loadPixelated(content.logo, LOGO_PIXELS).then((canvas) => {
        const ctx = tex.getContext() as CanvasRenderingContext2D;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, LOGO_PIXELS, LOGO_PIXELS);
        ctx.drawImage(canvas, 0, 0);
        tex.update();
      });
      this.material.diffuseTexture = tex;
      this.material.emissiveTexture = tex;
    }
    this.fresnel = new FresnelParameters();
    this.fresnel.bias = 0.25;
    this.fresnel.power = 3;
    this.fresnel.leftColor = FRAME_IDLE;
    this.fresnel.rightColor = Color3.Black();
    this.material.emissiveFresnelParameters = this.fresnel;
    this.mesh.material = this.material;

    this.mesh.enableEdgesRendering();
    engine.glowLayer.addIncludedOnlyMesh(this.mesh);
    this.setFrame(FRAME_IDLE, 4, 1);

    this.shadow = createShadowBlob(engine, `cube-shadow-${content.id}`, 2.6);
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setReaders(count: number): void {
    this.readers = count;
  }

  update(snap: CubeSnapshot): void {
    this.mesh.position.set(snap.x, snap.y, snap.z);
    this.mesh.rotation.set(snap.rx, snap.ry, 0);
    this.shadow.position.set(snap.x, 0.02, snap.z);
    this.shadow.scaling.setAll(Math.max(0.6, 1.3 - snap.y * 0.12));
    if (this.hovered) this.setFrame(FRAME_HOT, 6, 1.1);
    else if (this.readers > 0) this.setFrame(FRAME_READ, 5, 1.04);
    else this.setFrame(FRAME_IDLE, 4, 1);
  }

  private setFrame(color: Color3, width: number, scale: number): void {
    this.mesh.edgesWidth = width;
    this.mesh.edgesColor.set(color.r, color.g, color.b, 1);
    this.fresnel.leftColor = color;
    this.mesh.scaling.setAll(scale);
  }

  dispose(): void {
    this.shadow.dispose(false, true);
    this.mesh.dispose(false, true);
  }
}
