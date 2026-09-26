// A remote player: capsule body in their color, a dark visor showing where they look, a name tag.
import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode } from '@babylonjs/core';
import { EYE_HEIGHT } from '@world/shared';
import type { RemotePlayer } from '../net/Interpolation';
import type { Engine } from './Engine';

const BODY_HEIGHT = 1.8;
const BODY_RADIUS = 0.35;

export class Avatar {
  private readonly root: TransformNode;
  private readonly body: Mesh;
  private readonly head: TransformNode;
  private readonly tag: Mesh;

  constructor(engine: Engine, readonly id: string, name: string, color: string) {
    const scene = engine.scene;
    this.root = new TransformNode(`avatar-${id}`, scene);

    this.body = MeshBuilder.CreateCapsule(`avatar-body-${id}`, { height: BODY_HEIGHT, radius: BODY_RADIUS, tessellation: 12 }, scene);
    this.body.parent = this.root;
    this.body.position.y = BODY_HEIGHT / 2;
    this.body.isPickable = false;
    const mat = new StandardMaterial(`avatar-mat-${id}`, scene);
    const c = Color3.FromHexString(color);
    mat.diffuseColor = c;
    mat.emissiveColor = c.scale(0.25);
    mat.specularColor = Color3.Black();
    this.body.material = mat;
    engine.glowLayer.addIncludedOnlyMesh(this.body);

    this.head = new TransformNode(`avatar-head-${id}`, scene);
    this.head.parent = this.root;
    this.head.position.y = EYE_HEIGHT - 0.1;
    const visor = MeshBuilder.CreateBox(`avatar-visor-${id}`, { width: 0.5, height: 0.16, depth: 0.12 }, scene);
    visor.parent = this.head;
    visor.position.z = BODY_RADIUS - 0.02;
    visor.isPickable = false;
    const visorMat = new StandardMaterial(`avatar-visor-mat-${id}`, scene);
    visorMat.diffuseColor = new Color3(0.05, 0.05, 0.08);
    visorMat.emissiveColor = new Color3(0.1, 0.1, 0.15);
    visorMat.specularColor = Color3.Black();
    visor.material = visorMat;

    this.tag = this.createTag(engine, name, color);
    this.tag.parent = this.root;
    this.tag.position.y = BODY_HEIGHT + 0.45;
  }

  private createTag(engine: Engine, name: string, color: string): Mesh {
    const scene = engine.scene;
    const width = 512;
    const height = 128;
    const tex = new DynamicTexture(`avatar-tag-tex-${this.id}`, { width, height }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, width, height);
    ctx.font = 'bold 56px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(name, width / 2, height / 2);
    ctx.fillStyle = color;
    ctx.fillText(name, width / 2, height / 2);
    tex.update();

    const plane = MeshBuilder.CreatePlane(`avatar-tag-${this.id}`, { width: 2.4, height: 0.6 }, scene);
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
    this.root.position.set(p.x, p.y - EYE_HEIGHT, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.x = p.pitch;
    this.root.setEnabled(true);
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}

