// A billboard in the sky for one SkyContent entry. Placement, size and glow are uniform here;
// the content file only knows the image and the line it says.
import { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { worldBounds, worldDistance, type Rng, type SkyContent, type WorldPart } from '@world/shared';
import type { Engine } from './Engine';

const BASE_SIZE = 22;
const MIN_SPACING = 60;
const MIN_OUTSIDE = 15; // metres beyond the edge, so nothing floats over the playable floor
const MAX_OUTSIDE = 85;

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

// Spread the objects around the sky beyond the world's edge, well apart, at a distance where
// they read as scenery. Driven by a seeded rng so everyone in a room sees the same sky.
export function placeSkyObjects(engine: Engine, contents: SkyContent[], shape: WorldPart[], rng: Rng): SkyObject[] {
  const placed: Vector3[] = [];
  const b = worldBounds(shape);
  const pad = MAX_OUTSIDE;
  return contents.map((content) => {
    let position = Vector3.Zero();
    for (let attempt = 0; attempt < 200; attempt++) {
      const x = b.minX - pad + rng() * (b.maxX - b.minX + pad * 2);
      const z = b.minZ - pad + rng() * (b.maxZ - b.minZ + pad * 2);
      const outside = worldDistance(x, z, shape);
      if (outside < MIN_OUTSIDE || outside > MAX_OUTSIDE) continue;
      position = new Vector3(x, 25 + rng() * 45, z);
      if (placed.every((p) => Vector3.Distance(p, position) >= MIN_SPACING)) break;
    }
    placed.push(position);
    return new SkyObject(engine, content, position);
  });
}
