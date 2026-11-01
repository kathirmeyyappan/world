// An avatar whose head is its body: a trunk on two short legs with two arms and nothing else to
// move (Mike Wazowski, SpongeBob), skinned over five bones from a model made by
// scripts/monster-model.py. It walks with the arms swinging against the legs and the body bobbing, and the whole body tips with the look, since that is where the face is. A held item
// rides the right arm, which points forward to aim. It dies on its back with its limbs dropped.
// Movement and items are everyone's; the hit capsule is the avatar's own (AVATARS).
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import type { AvatarId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { aimArm, centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SkinnedBody, type SkinnedModel } from './skinned';

export type BodyBone = 'body' | 'armL' | 'armR' | 'legL' | 'legR';
const PARENTS: Record<BodyBone, BodyBone | null> = {
  body: null,
  armL: 'body',
  armR: 'body',
  legL: 'body',
  legR: 'body',
};

// What tells one such avatar from another.
export interface BodySpec {
  kind: AvatarId;
  model: SkinnedModel<BodyBone>;
  texture: string;
  shadow: number; // metres across
  legSwing: number; // radians each way at a full-speed walk
  armSwing: number;
  armsDown?: number; // radians the arms hang in from where the model holds them out
  bob: number; // metres the body rises mid-stride
  sway?: number; // radians the body rocks to each side with the stride: a crab's scuttle
  follow: number; // how much of the look's pitch the body tips by
  // Draw the inside of the model too: for one made of open shells, where a gap (under a chin, inside
  // a collar) looks into the back of another part rather than out the other side.
  doubleSided?: boolean;
}

// Lying on its back: radians the legs and arms drop toward the ground.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;

export class BodyAvatar implements Avatar {
  readonly kind: AvatarId;
  private readonly root: TransformNode;
  private readonly base: TransformNode; // the body's frame: tipped over when dead
  private readonly skin: SkinnedBody<BodyBone>;
  private readonly body: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly grip: TransformNode; // the right palm, turned so a held item's barrel runs along the look
  private readonly reach: Vector3; // which way the arm hangs from the shoulder in the model
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly gait: Gait;
  private dead = false;

  constructor(
    engine: Engine,
    readonly id: string,
    private readonly spec: BodySpec,
  ) {
    const scene = engine.scene;
    this.kind = spec.kind;
    this.gait = new Gait();
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.base = new TransformNode(`avatar-body-${id}`, scene);
    this.base.parent = this.root;

    this.skin = new SkinnedBody(engine, `${spec.kind}-${id}`, spec.model, spec.texture, PARENTS, this.base);
    this.body = this.skin.node('body');
    this.armL = this.skin.node('armL');
    this.armR = this.skin.node('armR');
    this.legL = this.skin.node('legL');
    this.legR = this.skin.node('legR');
    if (spec.doubleSided) {
      this.skin.material.backFaceCulling = false;
      this.skin.material.twoSidedLighting = true;
    }
    this.hitFlash = new HitFlash([this.skin.material]);

    this.grip = new TransformNode(`avatar-grip-${id}`, scene);
    this.grip.parent = this.armR;
    this.grip.position.copyFrom(this.skin.offset('armR', spec.model.hand));
    this.reach = this.grip.position.normalizeToNew();
    this.items = new HeldItems(
      engine,
      `${spec.kind}-${id}`,
      this.grip,
      Vector3.Zero(),
      this.body,
      this.skin.offset('body', spec.model.back),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, spec.shadow);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer, step: number): void {
    const { legSwing, armSwing, armsDown = 0, bob, sway = 0, follow, model } = this.spec;
    this.hitFlash.update();
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.body.rotation.x = p.pitch * follow;

    this.gait.update(p.x, p.z, airborne, step);
    const { phase, effort } = this.gait;
    const swing = airborne ? 0.4 : Math.sin(phase) * effort * legSwing;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = (-swing * armSwing) / legSwing;
    this.armL.rotation.z = armsDown;
    if (p.item && !p.dead) aimArm(this.armR, this.grip, this.reach, p.pitch * (1 - follow));
    else {
      this.armR.rotationQuaternion = null;
      this.armR.rotation.x = (swing * armSwing) / legSwing;
      this.armR.rotation.z = -armsDown;
    }
    this.base.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * bob * effort;
    this.base.rotation.z = airborne ? 0 : Math.sin(phase) * sway * effort;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Toppled onto its back, head away from where it was going, lifted by the body's depth so it
      // lies on the ground rather than through it.
      this.base.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.base.position.y = p.dead ? model.lie : 0;
    }
    if (p.dead) {
      this.base.rotation.z = 0;
      this.legL.rotation.x = this.legR.rotation.x = DEAD_LEGS;
      this.armR.rotationQuaternion = null;
      this.armL.rotation.x = this.armR.rotation.x = DEAD_ARMS;
      this.body.rotation.x = 0;
      this.base.position.y = model.lie;
    }
    placeShadow(this.shadow, p, feetY);
    this.root.setEnabled(true);
  }

  flash(): void {
    this.hitFlash.trigger();
  }

  fire(): void {
    this.items.fire();
  }

  scaleWeapons(factor: number): void {
    this.items.scaleWeapons(factor);
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.skin.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.base) : null;
  }
}
