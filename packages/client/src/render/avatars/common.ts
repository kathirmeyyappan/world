// Pieces every avatar type shares: the ground shadow, a box helper, the walk cycle, and the
// interface the Game drives them through. Names are drawn over avatars by the HUD (ui/NameTags.ts), not in the scene.
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
import { MOVE_SPEED, WORLD_STRUCTURES, type AvatarId } from '@world/shared';
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

const GAIT_EASE = 0.1; // seconds the stride takes to follow a change of speed

// A walk cycle from where a player is, frame to frame. `phase` (radians) advances with the distance
// covered on the ground, `perMetre` a metre, so a slow walk steps slowly; `effort` (0 to 1) is how
// big the steps are, following speed against a full-speed walk (its square root, so a slow walk
// still visibly steps), eased so a jittery frame doesn't twitch the legs. 0 in the air.
export class Gait {
  phase = 0;
  effort = 0;
  private last: { x: number; z: number; time: number } | null = null;

  constructor(private readonly perMetre: number) {}

  update(x: number, z: number, airborne: boolean): void {
    const time = performance.now() / 1000;
    const last = this.last;
    this.last = { x, z, time };
    if (!last) return;
    const moved = Math.hypot(x - last.x, z - last.z);
    const dt = time - last.time;
    if (moved > 0.002 && !airborne) this.phase += moved * this.perMetre;
    const speed = dt > 0 ? moved / dt : 0;
    const target = airborne ? 0 : Math.sqrt(Math.min(1, speed / MOVE_SPEED));
    this.effort += (target - this.effort) * Math.min(1, dt / GAIT_EASE);
  }
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

// Lays a child shadow blob on whatever is under the avatar whose feet are at `feetY`: at the feet
// while standing, else on the highest surface below them, fading smaller the higher they are.
export function placeShadow(shadow: Mesh, p: RemotePlayer, feetY: number): void {
  const height = p.grounded ? 0 : feetY - WORLD_STRUCTURES.groundAt(p.x, p.z, feetY);
  shadow.position.y = 0.02 - height;
  shadow.scaling.setAll(Math.max(0.5, 1 - height * 0.15));
}

// A matte material of one colour, lit a little from within (`glow`) so it reads in the dark.
export function flat(scene: Engine['scene'], name: string, color: Color3, glow: number): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.emissiveColor = color.scale(glow);
  m.specularColor = Color3.Black();
  return m;
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
