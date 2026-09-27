// The standard avatar: a blocky figure in the player's colour with a glowing visor, a shadow on
// the ground, a walk cycle driven by how far they moved, and a name tag. No outline pass: thin
// lines shimmer at the reduced render resolution.
import { Color3, Mesh, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { box, createShadowBlob, createTag, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

export class StandardAvatar implements Avatar {
  readonly kind = 'standard' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly head: TransformNode;
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
  private readonly shadow: Mesh;
  private readonly tag: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private dead = false;
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

    this.hitFlash = new HitFlash([suit, skin]);

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


    // Items go in the right hand; the arm points forward while holding one so it reads as aiming.
    // The flamethrower's tank sits on the back of the torso.
    this.items = new HeldItems(engine, `avatar-${id}`, this.armR, new Vector3(0, -0.32, 0.04), this.body, new Vector3(0, 1.12, -0.28));

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.1);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;

    this.tag = createTag(engine, id, name, color);
    this.tag.parent = this.root;
    this.tag.position.y = EYE_HEIGHT + 0.6;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
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
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : swing * 0.8;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.04;
    this.items.update(p.item, p.firing);
    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen: the whole body tipped onto its side, tag left standing so the name stays readable.
      this.body.rotation.z = p.dead ? Math.PI / 2 : 0;
      this.body.position.x = p.dead ? 0.3 : 0;
    }
    if (p.dead) {
      this.legL.rotation.x = this.legR.rotation.x = this.armL.rotation.x = 0;
      this.body.position.y = 0.3;
    }
    this.shadow.position.y = 0.02 - feetY;
    this.shadow.scaling.setAll(Math.max(0.5, 1 - feetY * 0.15));
    this.root.setEnabled(true);
  }

  flash(): void {
    this.hitFlash.trigger();
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose(false, true);
  }
}
