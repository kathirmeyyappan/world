// Visual for one info cube. Position and rotation come from the server every frame; hover and
// "someone is reading this" are the only local effects.
import { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3, type Scene } from '@babylonjs/core';
import type { CubeContent, CubeSnapshot } from '@world/shared';
import type { Engine } from './Engine';

const SIZE = 1.8;
const BORDER_THICKNESS = 0.16;

export class CubeMesh {
  readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly baseColor: Color3;
  private hovered = false;
  private readers = 0;
  private time = Math.random() * 10;

  constructor(engine: Engine, readonly content: CubeContent) {
    const scene = engine.scene;
    this.mesh = MeshBuilder.CreateBox(`cube-${content.id}`, { size: SIZE }, scene);
    this.material = new StandardMaterial(`mat-${content.id}`, scene);
    this.baseColor = Color3.FromHexString(content.glowColor);
    this.material.diffuseColor = this.baseColor;
    this.material.emissiveColor = this.baseColor.scale(0.3);
    this.material.specularColor = Color3.Black();
    this.material.roughness = 1;
    if (content.logo) this.material.diffuseTexture = new Texture(content.logo, scene);
    this.mesh.material = this.material;
    engine.glowLayer.addIncludedOnlyMesh(this.mesh);
    this.createBorder(scene, Color3.FromHexString(content.borderColor ?? '#ffffff'));
  }

  private createBorder(scene: Scene, color: Color3): void {
    const h = SIZE / 2 + 0.01;
    const v = [
      new Vector3(-h, -h, -h), new Vector3(h, -h, -h), new Vector3(h, -h, h), new Vector3(-h, -h, h),
      new Vector3(-h, h, -h), new Vector3(h, h, -h), new Vector3(h, h, h), new Vector3(-h, h, h),
    ];
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const mat = new StandardMaterial(`border-mat-${this.content.id}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color;
    mat.disableLighting = true;
    edges.forEach(([a, b], i) => {
      const start = v[a];
      const end = v[b];
      const cyl = MeshBuilder.CreateCylinder(
        `border-${this.content.id}-${i}`,
        { height: Vector3.Distance(start, end), diameter: BORDER_THICKNESS, tessellation: 8 },
        scene,
      );
      cyl.setParent(this.mesh);
      cyl.position = start.add(end).scale(0.5);
      cyl.lookAt(end);
      cyl.rotate(Vector3.Right(), Math.PI / 2);
      cyl.material = mat;
      cyl.isPickable = false;
    });
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
    if (this.hovered) {
      const pulse = (Math.sin(this.time * 5) + 1) / 2;
      this.material.emissiveColor = this.baseColor.scale(0.5 + pulse * 0.3);
      this.mesh.scaling.setAll(1.15);
    } else if (this.readers > 0) {
      const pulse = (Math.sin(this.time * 2) + 1) / 2;
      this.material.emissiveColor = Color3.Lerp(this.baseColor.scale(0.4), Color3.White().scale(0.6), pulse * 0.5);
      this.mesh.scaling.setAll(1.05);
    } else {
      this.material.emissiveColor = this.baseColor.scale(0.3);
      this.mesh.scaling.setAll(1);
    }
  }

  dispose(): void {
    this.mesh.dispose(false, true);
  }
}
