// Floating pickups (sim/pickups.ts), drawn where the server says. Each kind is a shape at a size,
// drawn as instances, so any number of them cost one draw call per shape: a heart is the HUD's
// pixel heart, two voxels deep, red and shaded by face like the structures, and a big heart (what a
// dead player leaves) is the same heart at twice the size.
import { Color3, Color4, Mesh, MeshBuilder, StandardMaterial, type InstancedMesh } from '@babylonjs/core';
import type { PickupKind, PickupSnapshot } from '@world/shared';
import { HEART } from '../ui/pixelIcons';
import type { Engine } from './Engine';

const VOXEL = 0.075; // metres per pixel of the heart: 9 pixels make it about 0.7 m across
const DEPTH = 2; // voxels deep
const RED = new Color3(0.95, 0.16, 0.22);
const HIGHLIGHT = new Color3(1, 0.72, 0.76);
// Face shading by direction (Babylon's box faces: front, back, right, left, top, bottom).
const FACE_SHADE = [1, 1, 0.72, 0.72, 0.86, 0.55];

export class Pickups {
  private readonly shapes: Record<PickupKind, { mesh: Mesh; scale: number }>;
  private readonly drawn = new Map<string, InstancedMesh>();

  constructor(engine: Engine) {
    const heart = buildHeart(engine);
    this.shapes = { heart: { mesh: heart, scale: 1 }, 'big-heart': { mesh: heart, scale: 2 } };
  }

  update(pickups: PickupSnapshot[]): void {
    const seen = new Set<string>();
    for (const p of pickups) {
      seen.add(p.id);
      let d = this.drawn.get(p.id);
      if (!d) {
        const shape = this.shapes[p.kind];
        d = shape.mesh.createInstance(`pickup-${p.id}`);
        d.scaling.setAll(shape.scale);
        d.isPickable = false;
        this.drawn.set(p.id, d);
      }
      d.position.set(p.x, p.y, p.z);
      d.rotation.y = p.ry;
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      d.dispose();
      this.drawn.delete(id);
    }
  }
}

// The pixel heart as voxels, centred on its middle, colours baked into the vertices.
function buildHeart(engine: Engine): Mesh {
  const scene = engine.scene;
  const rows = HEART.length;
  const cols = HEART[0].length;
  const voxels: Mesh[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = HEART[r][c];
      if (px === '.') continue;
      const color = px === '+' ? HIGHLIGHT : RED;
      const faceColors = FACE_SHADE.map((s) => new Color4(color.r * s, color.g * s, color.b * s, 1));
      for (let k = 0; k < DEPTH; k++) {
        const v = MeshBuilder.CreateBox('heart-voxel', { size: VOXEL, faceColors }, scene);
        v.position.set((c - (cols - 1) / 2) * VOXEL, ((rows - 1) / 2 - r) * VOXEL, (k - (DEPTH - 1) / 2) * VOXEL);
        voxels.push(v);
      }
    }
  }
  const heart = Mesh.MergeMeshes(voxels, true)!;
  heart.name = 'pickup-heart';
  const mat = new StandardMaterial('pickup-heart-mat', scene);
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(0.8, 0.8, 0.8); // times the vertex colours: unlit, a touch under bloom
  heart.material = mat;
  heart.isPickable = false;
  heart.setEnabled(false); // the shape itself isn't drawn; its instances are
  return heart;
}
