// Visual for one info cube. Position and rotation come from the server every frame; hover and
// "someone is reading this" are the only local effects.
import { Color3, FresnelParameters, Mesh, MeshBuilder, StandardMaterial, Texture } from '@babylonjs/core';
import { CUBE_COLORS, type CubeContent, type CubeSnapshot } from '@world/shared';
import { createShadowBlob } from './Avatar';
import type { Engine } from './Engine';

const SIZE = 1.8;

export class CubeMesh {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly baseColor: Color3;
  private readonly shadow: Mesh;
  private readonly fresnel: FresnelParameters;
  private hovered = false;
  private readers = 0;

  constructor(engine: Engine, readonly content: CubeContent, index: number) {
    const scene = engine.scene;
    const color = CUBE_COLORS[index % CUBE_COLORS.length];
    this.mesh = MeshBuilder.CreateBox(`cube-${content.id}`, { size: SIZE, wrap: true }, scene);
    this.material = new StandardMaterial(`mat-${content.id}`, scene);
    this.baseColor = Color3.FromHexString(color);
    this.material.diffuseColor = Color3.Lerp(Color3.White(), this.baseColor, 0.35);
    this.material.emissiveColor = this.baseColor.scale(0.45);
    this.material.specularColor = new Color3(0.15, 0.15, 0.15);
    this.material.specularPower = 24;
    if (content.logo) {
      // Nearest magnification keeps the pixel look up close; mipmaps stop it sparkling at distance.
      const logo = new Texture(content.logo, scene, false, true, Texture.NEAREST_NEAREST_MIPLINEAR);
      this.material.diffuseTexture = logo;
      this.material.emissiveTexture = logo;
    }
    this.fresnel = new FresnelParameters();
    this.fresnel.bias = 0.2;
    this.fresnel.power = 2.5;
    this.fresnel.leftColor = this.baseColor;
    this.fresnel.rightColor = Color3.Black();
    this.material.emissiveFresnelParameters = this.fresnel;
    this.mesh.material = this.material;

    this.mesh.enableEdgesRendering();
    this.mesh.edgesWidth = 4;
    this.mesh.edgesColor.set(this.baseColor.r, this.baseColor.g, this.baseColor.b, 1);
    engine.glowLayer.addIncludedOnlyMesh(this.mesh);

    this.shadow = createShadowBlob(engine, `cube-shadow-${content.id}`, 2.6);
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setReaders(count: number): void {
    this.readers = count;
  }

  // Hover and "being read" change the frame, never the face, so the logo stays readable.
  update(snap: CubeSnapshot): void {
    this.mesh.position.set(snap.x, snap.y, snap.z);
    this.mesh.rotation.set(snap.rx, snap.ry, 0);
    this.shadow.position.set(snap.x, 0.02, snap.z);
    this.shadow.scaling.setAll(Math.max(0.6, 1.3 - snap.y * 0.12));
    if (this.hovered) {
      this.setFrame(this.baseColor, 6, 1.1);
    } else if (this.readers > 0) {
      this.setFrame(Color3.White(), 5, 1.04);
    } else {
      this.setFrame(this.baseColor, 4, 1);
    }
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
