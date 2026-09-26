// A billboard in the sky for one SkyContent entry. Placement, size and glow are uniform here;
// the content file only knows the image and the line it says.
import { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import type { SkyContent } from '@world/shared';
import type { Engine } from './Engine';

const BASE_SIZE = 22;
const MIN_SPACING = 60;

export class SkyObject {
  readonly mesh: Mesh;

  constructor(engine: Engine, readonly content: SkyContent, position: Vector3) {
    const scene = engine.scene;
    this.mesh = MeshBuilder.CreatePlane(`sky-${content.id}`, { size: BASE_SIZE }, scene);
    this.mesh.position = position;
    this.mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.mesh.applyFog = false;
    this.mesh.isPickable = true;

    const mat = new StandardMaterial(`sky-mat-${content.id}`, scene);
    const tex = new Texture(content.image, scene, false, true, Texture.NEAREST_NEAREST_MIPLINEAR);
    tex.hasAlpha = true;
    tex.onLoadObservable.addOnce(() => {
      const internal = tex.getInternalTexture();
      if (!internal) return;
      const aspect = internal.width / internal.height;
      this.mesh.scaling.set(aspect >= 1 ? aspect : 1, aspect >= 1 ? 1 : 1 / aspect, 1);
    });
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(0.7, 0.7, 0.7);
    mat.useAlphaFromDiffuseTexture = true;
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    this.mesh.material = mat;
  }

  setHovered(hovered: boolean): void {
    const v = hovered ? 1 : 0.7;
    (this.mesh.material as StandardMaterial).emissiveColor.set(v, v, v);
  }

  // Where a speech bubble should point: just above the object.
  anchor(): Vector3 {
    return this.mesh.position.add(new Vector3(0, BASE_SIZE * 0.55, 0));
  }
}

// Spread the objects around the sky, well apart, at a distance where they read as scenery.
export function placeSkyObjects(engine: Engine, contents: SkyContent[], worldRadius: number): SkyObject[] {
  const placed: Vector3[] = [];
  return contents.map((content) => {
    let position = Vector3.Zero();
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = worldRadius * 1.2 + Math.random() * worldRadius * 1.5;
      position = new Vector3(Math.cos(angle) * distance, 25 + Math.random() * 45, Math.sin(angle) * distance);
      if (placed.every((p) => Vector3.Distance(p, position) >= MIN_SPACING)) break;
    }
    placed.push(position);
    return new SkyObject(engine, content, position);
  });
}
