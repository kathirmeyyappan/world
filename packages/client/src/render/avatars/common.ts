// Pieces every avatar type shares: the ground shadow, a box helper, the name tag, and the
// interface the Game drives them through.
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  type Vector3,
} from '@babylonjs/core';
import type { AvatarId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';

export interface Avatar {
  readonly id: string;
  readonly kind: AvatarId;
  update(p: RemotePlayer): void;
  flash(): void; // took a hit: blink red
  hide(): void;
  dispose(): void;
  corpse(): Vector3 | null; // where the body lies, while dead and drawn; null otherwise
}

// The middle of a node and everything under it, in world space: a fallen body's centre.
export function centreOf(node: TransformNode): Vector3 {
  const { min, max } = node.getHierarchyBoundingVectors();
  return min.add(max).scale(0.5);
}

let shadowTexture: DynamicTexture | null = null;

// Soft radial shadow, shared by everything that casts one.
export function getShadowTexture(engine: Engine): DynamicTexture {
  if (shadowTexture) return shadowTexture;
  const size = 64;
  shadowTexture = new DynamicTexture('shadowTex', size, engine.scene, false, Texture.NEAREST_SAMPLINGMODE);
  shadowTexture.hasAlpha = true;
  const ctx = shadowTexture.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  shadowTexture.update();
  return shadowTexture;
}

export function createShadowBlob(engine: Engine, name: string, diameter: number): Mesh {
  const scene = engine.scene;
  const disc = MeshBuilder.CreatePlane(name, { size: diameter }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.isPickable = false;
  const mat = new StandardMaterial(`${name}-mat`, scene);
  mat.diffuseTexture = getShadowTexture(engine);
  mat.opacityTexture = mat.diffuseTexture;
  mat.diffuseColor = Color3.Black();
  mat.emissiveColor = Color3.Black();
  mat.disableLighting = true;
  disc.material = mat;
  return disc;
}

export function box(
  scene: Engine['scene'],
  name: string,
  w: number,
  h: number,
  d: number,
  mat: StandardMaterial,
  parent: TransformNode,
): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

export function createTag(engine: Engine, id: string, name: string, color: string): Mesh {
  const scene = engine.scene;
  const width = 256;
  const height = 64;
  const tex = new DynamicTexture(`avatar-tag-tex-${id}`, { width, height }, scene, false, Texture.NEAREST_SAMPLINGMODE);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, width, height);
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(name, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.fillText(name, width / 2, height / 2);
  tex.update();

  const plane = MeshBuilder.CreatePlane(`avatar-tag-${id}`, { width: 2, height: 0.5 }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  const mat = new StandardMaterial(`avatar-tag-mat-${id}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  return plane;
}
