// A remote player: a blocky figure in their colour with a glowing visor, a shadow on the ground,
// a walk cycle driven by how far they moved, and a name tag. No outline pass: thin lines shimmer
// at the reduced render resolution.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT } from '@world/shared';
import type { RemotePlayer } from '../net/Interpolation';
import type { Engine } from './Engine';

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

function box(scene: Engine['scene'], name: string, w: number, h: number, d: number, mat: StandardMaterial, parent: TransformNode): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

export class Avatar {
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly head: TransformNode;
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
  private readonly shadow: Mesh;
  private readonly tag: Mesh;
  private phase = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(engine: Engine, readonly id: string, name: string, color: string) {
    const scene = engine.scene;
    const c = Color3.FromHexString(color);
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    const suit = new StandardMaterial(`avatar-suit-${id}`, scene);
    suit.diffuseColor = c.scale(0.7);
    suit.emissiveColor = c.scale(0.22);
    suit.specularColor = Color3.Black();
    const skin = new StandardMaterial(`avatar-skin-${id}`, scene);
    skin.diffuseColor = c.scale(0.95);
    skin.emissiveColor = c.scale(0.3);
    skin.specularColor = Color3.Black();
    const visorMat = new StandardMaterial(`avatar-visor-${id}`, scene);
    visorMat.diffuseColor = Color3.Black();
    visorMat.emissiveColor = c;
    visorMat.disableLighting = true;

    this.legL = box(scene, `avatar-legL-${id}`, 0.22, 0.7, 0.24, suit, this.body);
    this.legR = box(scene, `avatar-legR-${id}`, 0.22, 0.7, 0.24, suit, this.body);
    this.legL.position.set(-0.14, 0.35, 0);
    this.legR.position.set(0.14, 0.35, 0);
    this.legL.setPivotPoint(new Vector3(0, 0.35, 0));
    this.legR.setPivotPoint(new Vector3(0, 0.35, 0));

    const torso = box(scene, `avatar-torso-${id}`, 0.58, 0.72, 0.34, suit, this.body);
    torso.position.y = 1.06;

    this.armL = box(scene, `avatar-armL-${id}`, 0.17, 0.62, 0.2, skin, this.body);
    this.armR = box(scene, `avatar-armR-${id}`, 0.17, 0.62, 0.2, skin, this.body);
    this.armL.position.set(-0.41, 1.08, 0);
    this.armR.position.set(0.41, 1.08, 0);
    this.armL.setPivotPoint(new Vector3(0, 0.31, 0));
    this.armR.setPivotPoint(new Vector3(0, 0.31, 0));

    this.head = new TransformNode(`avatar-head-${id}`, scene);
    this.head.parent = this.body;
    this.head.position.y = EYE_HEIGHT - 0.02;
    const skull = box(scene, `avatar-skull-${id}`, 0.46, 0.46, 0.46, skin, this.head);
    skull.position.y = 0;
    const visor = box(scene, `avatar-visorMesh-${id}`, 0.4, 0.1, 0.06, visorMat, this.head);
    visor.position.set(0, 0.04, 0.23);
    engine.glowLayer.addIncludedOnlyMesh(visor);


    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.1);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;

    this.tag = this.createTag(engine, name, color);
    this.tag.parent = this.root;
    this.tag.position.y = EYE_HEIGHT + 0.6;
  }

  private createTag(engine: Engine, name: string, color: string): Mesh {
    const scene = engine.scene;
    const width = 256;
    const height = 64;
    const tex = new DynamicTexture(`avatar-tag-tex-${this.id}`, { width, height }, scene, false, Texture.NEAREST_SAMPLINGMODE);
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

    const plane = MeshBuilder.CreatePlane(`avatar-tag-${this.id}`, { width: 2, height: 0.5 }, scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    const mat = new StandardMaterial(`avatar-tag-mat-${this.id}`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;
    return plane;
  }

  update(p: RemotePlayer): void {
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const feetY = p.y - EYE_HEIGHT;
    const airborne = feetY > 0.05;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.x = p.pitch * 0.6;

    if (moved > 0.002 && !airborne) this.phase += moved * 4.5;
    const swing = airborne ? 0.35 : Math.sin(this.phase) * Math.min(1, moved * 60) * 0.7;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.04;
    this.shadow.position.y = 0.02 - feetY;
    this.shadow.scaling.setAll(Math.max(0.5, 1 - feetY * 0.15));
    this.root.setEnabled(true);
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
