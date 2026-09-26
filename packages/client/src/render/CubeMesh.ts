// Visual for one info cube. Position and rotation come from the server every frame; hover and
// "someone is reading this" are the only local effects.
import { Color3, FresnelParameters, Mesh, MeshBuilder, StandardMaterial, Texture } from '@babylonjs/core';
import type { CubeContent, CubeSnapshot } from '@world/shared';
import { createShadowBlob } from './Avatar';
import type { Engine } from './Engine';

const SIZE = 1.8;

export class CubeMesh {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly baseColor: Color3;
  private readonly shadow: Mesh;
  private hovered = false;
  private readers = 0;
  private time = Math.random() * 10;

  constructor(engine: Engine, readonly content: CubeContent) {
    const scene = engine.scene;
    this.mesh = MeshBuilder.CreateBox(`cube-${content.id}`, { size: SIZE, wrap: true }, scene);
    this.material = new StandardMaterial(`mat-${content.id}`, scene);
    this.baseColor = Color3.FromHexString(content.glowColor);
    this.material.diffuseColor = this.baseColor;
    this.material.emissiveColor = this.baseColor.scale(0.25);
    this.material.specularColor = new Color3(0.15, 0.15, 0.15);
    this.material.specularPower = 24;
    if (content.logo) this.material.diffuseTexture = new Texture(content.logo, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
    const fresnel = new FresnelParameters();
    fresnel.bias = 0.2;
    fresnel.power = 2.5;
    fresnel.leftColor = Color3.FromHexString(content.borderColor ?? '#ffffff');
    fresnel.rightColor = Color3.Black();
    this.material.emissiveFresnelParameters = fresnel;
    this.mesh.material = this.material;

    const border = Color3.FromHexString(content.borderColor ?? '#ffffff');
    this.mesh.enableEdgesRendering();
    this.mesh.edgesWidth = 6;
    this.mesh.edgesColor.set(border.r, border.g, border.b, 1);
    engine.glowLayer.addIncludedOnlyMesh(this.mesh);

    this.shadow = createShadowBlob(engine, `cube-shadow-${content.id}`, 2.6);
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setReaders(count: number): void {
    this.readers = count;
  }

  update(snap: CubeSnapshot, dt: number): void {
    this.time += dt;
    this.mesh.position.set(snap.x, snap.y, snap.z);
    this.mesh.rotation.set(snap.rx, snap.ry, 0);
    this.shadow.position.set(snap.x, 0.02, snap.z);
    this.shadow.scaling.setAll(Math.max(0.6, 1.3 - snap.y * 0.12));
    if (this.hovered) {
      const pulse = (Math.sin(this.time * 5) + 1) / 2;
      this.material.emissiveColor = this.baseColor.scale(0.45 + pulse * 0.35);
      this.mesh.scaling.setAll(1.12);
    } else if (this.readers > 0) {
      const pulse = (Math.sin(this.time * 2) + 1) / 2;
      this.material.emissiveColor = Color3.Lerp(this.baseColor.scale(0.35), Color3.White().scale(0.5), pulse * 0.5);
      this.mesh.scaling.setAll(1.04);
    } else {
      this.material.emissiveColor = this.baseColor.scale(0.25);
      this.mesh.scaling.setAll(1);
    }
  }

  dispose(): void {
    this.shadow.dispose(false, true);
    this.mesh.dispose(false, true);
  }
}
