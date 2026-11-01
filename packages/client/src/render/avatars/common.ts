// Pieces every avatar type shares: the ground shadow, a box helper, the walk cycle, and the
// interface the Game drives them through. Names are drawn over avatars by the HUD (ui/NameTags.ts), not in the scene.
import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { MOVE_SPEED, WORLD_STRUCTURES, type AvatarId, type ItemAction } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';

export interface Avatar {
  readonly id: string;
  readonly kind: AvatarId;
  update(p: RemotePlayer, step: number): void; // `step` is where they are in their stride (Footsteps.phase)
  flash(): void; // took a hit: blink red
  fire(): void; // shot a tap weapon: muzzle flash
  scaleWeapons(factor: number): void; // its guns drawn this much bigger: the player's own body
  hide(): void;
  dispose(): void;
  corpse(): Vector3 | null; // where the body lies, while dead and drawn; null otherwise
  setHeadless?(on: boolean): void; // draw the body without the head, for its own wearer's view from its eyes
  act?(action: ItemAction): void; // did one of its class's own actions (a dragon's roar)
}

const GAIT_EASE = 0.1; // seconds the stride takes to follow a change of speed

// A walk cycle from where a player is, frame to frame. `phase` (radians) is the stride's, paced by
// the footsteps (`step`: 0 at one foot's fall, 1 at the other's, 2 back at the first's), a leg out
// at each footfall, so the legs land with the sounds; `effort` (0 to 1) is how big the steps are,
// following speed against a full-speed walk (its square root, so a slow walk still visibly steps),
// eased so a jittery frame doesn't twitch the legs. 0 in the air.
export class Gait {
  phase = 0;
  effort = 0;
  private last: { x: number; z: number; time: number } | null = null;

  update(x: number, z: number, airborne: boolean, step: number): void {
    const time = performance.now() / 1000;
    const last = this.last;
    this.last = { x, z, time };
    this.phase = Math.PI / 2 + Math.PI * step;
    if (!last) return;
    const moved = Math.hypot(x - last.x, z - last.z);
    const dt = time - last.time;
    const speed = dt > 0 ? moved / dt : 0;
    const target = airborne ? 0 : Math.sqrt(Math.min(1, speed / MOVE_SPEED));
    this.effort += (target - this.effort) * Math.min(1, dt / GAIT_EASE);
  }
}

// Points an arm from the way it hangs in the model (`reach`, shoulder to hand) to `pitch` down of
// straight ahead, and turns the grip at its hand so an item's barrel (its -y) runs along the arm
// with its top (its +z) up, whatever the model's hand is doing.
export function aimArm(arm: TransformNode, grip: TransformNode, reach: Vector3, pitch: number): void {
  const ahead = new Vector3(0, -Math.sin(pitch), Math.cos(pitch));
  const turn = (arm.rotationQuaternion ??= new Quaternion());
  Quaternion.FromUnitVectorsToRef(reach, ahead, turn);
  const right = Vector3.Cross(Vector3.Up(), ahead).normalize();
  const top = Vector3.Cross(ahead, right);
  const hand = Matrix.FromXYZAxesToRef(right, ahead.negate(), top, new Matrix());
  const local = hand.multiply(Matrix.Invert(turn.toRotationMatrix(new Matrix())));
  Quaternion.FromRotationMatrixToRef(local, (grip.rotationQuaternion ??= new Quaternion()));
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
