// Static scenery: the neon grid ground, the red dome at the world edge, and billboards in the sky.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import type { Engine } from './Engine';

const SKY_OBJECTS = [
  { image: 'moon.png', size: 20, glow: new Color3(0.8, 0.8, 0.8) },
  { image: 'mugiwara.png', size: 30, glow: new Color3(0.7, 0.7, 0.7) },
  { image: 'patriots.png', size: 25, glow: new Color3(0.5, 0.5, 0.5) },
  { image: 'drake_maye.png', size: 30, glow: new Color3(0.3, 0.3, 0.3) },
];

export class Environment {
  constructor(private readonly engine: Engine, private readonly radius: number) {
    this.createGround();
    this.createDome();
    this.createSkyObjects();
  }

  private createGround(): void {
    const scene = this.engine.scene;
    const make = (name: string, r: number, y: number, dim: boolean) => {
      const disc = MeshBuilder.CreateDisc(name, { radius: r, tessellation: 128 }, scene);
      disc.rotation.x = Math.PI / 2;
      disc.position.y = y;
      disc.isPickable = false;
      const mat = new StandardMaterial(`${name}Mat`, scene);
      mat.diffuseColor = new Color3(0.3, 0.5, 0.35);
      mat.specularColor = Color3.Black();
      mat.roughness = 1;
      mat.diffuseTexture = this.gridTexture(`${name}Grid`, 2048, r, dim ? 'rgba(200, 255, 120, 0.3)' : 'rgba(220, 255, 140, 0.6)', '#1a3a20', 2);
      disc.material = mat;
    };
    make('ground', this.radius * 2, 0.01, false);
    make('extendedGround', this.radius * 10, -0.01, true);
  }

  private createDome(): void {
    const scene = this.engine.scene;
    const domeRadius = this.radius * 1.1;
    const dome = MeshBuilder.CreateSphere('dome', { diameter: domeRadius * 2, segments: 64, slice: 0.5 }, scene);
    dome.position.y = -domeRadius * 0.41;
    dome.isPickable = false;
    const mat = new StandardMaterial('domeMat', scene);
    mat.diffuseColor = new Color3(0.4, 0.1, 0.15);
    mat.emissiveColor = new Color3(0.6, 0.2, 0.25);
    mat.specularColor = Color3.Black();
    mat.roughness = 1;
    mat.alpha = 0.5;
    mat.backFaceCulling = false;
    const tex = this.gridTexture('domeGrid', 512, this.radius, 'rgba(255, 100, 100, 1.0)', 'rgba(40, 10, 15, 0.15)', 1, 1.5, 4.5);
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    dome.material = mat;
  }

  private createSkyObjects(): void {
    const scene = this.engine.scene;
    const placed: Vector3[] = [];
    for (const obj of SKY_OBJECTS) {
      let position = Vector3.Zero();
      for (let attempt = 0; attempt < 100; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = this.radius * 0.8 + Math.random() * this.radius * 2;
        position = new Vector3(Math.cos(angle) * distance, 30 + Math.random() * 80, Math.sin(angle) * distance);
        if (placed.every((p) => Vector3.Distance(p, position) >= 100)) break;
      }
      placed.push(position);

      const mat = new StandardMaterial(`skyMat_${obj.image}`, scene);
      const tex = new Texture(`/assets/textures/sky/${obj.image}`, scene, false, true);
      tex.hasAlpha = true;
      tex.onLoadObservable.addOnce(() => {
        const internal = tex.getInternalTexture();
        if (!internal) return;
        const aspect = internal.width / internal.height;
        const width = aspect >= 1 ? obj.size * aspect : obj.size;
        const height = aspect >= 1 ? obj.size : obj.size / aspect;
        const plane = MeshBuilder.CreatePlane(`sky_${obj.image}`, { width, height }, scene);
        plane.position = position;
        plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;
        mat.diffuseTexture = tex;
        mat.emissiveTexture = tex;
        mat.emissiveColor = obj.glow;
        mat.useAlphaFromDiffuseTexture = true;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        plane.material = mat;
        this.engine.glowLayer.addIncludedOnlyMesh(plane);
      });
    }
  }

  private gridTexture(
    name: string, size: number, worldRadius: number, stroke: string, fill: string, lineWidth: number, vScale = 1, hScale = 1,
  ): DynamicTexture {
    const texture = new DynamicTexture(name, size, this.engine.scene, true);
    const ctx = texture.getContext();
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    const spacing = size / (worldRadius / 0.5);
    for (let x = 0; x <= size; x += spacing * vScale) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += spacing * hScale) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    texture.update();
    return texture;
  }
}
