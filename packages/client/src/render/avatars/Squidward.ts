// Squidward Tentacles: a 3.2 m octopus in a brown shirt, from Super Tablé's model
// (squidwardModel.ts, made by scripts/monster-model.py), skinned over eight bones: the body, the
// head, the arms and four tentacle legs. He walks as on the show: the two legs of a side step
// together, the back one a little behind the front, left and right in turn, each side's landing a
// plop (gaits.ts); the arms swing gently against them, the body bobs and rocks a little, and the
// head turns with the look. A held item rides the right arm, which points forward to aim. He dies
// on his back with his limbs dropped. Worn with /squidward; his hit capsule is
// AVATARS.squidward.hitbox, movement and items are everyone's.
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { aimArm, centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SkinnedBody } from './skinned';
import { SQUIDWARD_MODEL } from './squidwardModel';

const TEXTURE = '/assets/textures/avatars/squidward.png';
const LEG_SWING = 0.45; // radians each way at a full-speed walk
const TRAIL = 0.6; // radians of the stride a side's back leg swings behind its front one
const ARM_SWING = 0.2;
const BOB = 0.04; // metres the body rises mid-stride
const SWAY = 0.03; // radians the body rocks to each side with the stride
const HEAD_FOLLOW = 0.6; // how much of the look's pitch the head takes
// Lying on his back: radians the legs and arms drop toward the ground and the head tips back.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;
const DEAD_HEAD = -0.3;

type Bone = keyof typeof SQUIDWARD_MODEL.bones;
const PARENTS: Record<Bone, Bone | null> = {
  body: null,
  head: 'body',
  armL: 'body',
  armR: 'body',
  legFL: 'body',
  legFR: 'body',
  legBL: 'body',
  legBR: 'body',
};
// Each leg's side (the left swings with the stride, the right against it) and how far behind the
// stride it swings.
const LEGS: { bone: Bone; side: 1 | -1; lag: number }[] = [
  { bone: 'legFL', side: 1, lag: 0 },
  { bone: 'legBL', side: 1, lag: TRAIL },
  { bone: 'legFR', side: -1, lag: 0 },
  { bone: 'legBR', side: -1, lag: TRAIL },
];

export class SquidwardAvatar implements Avatar {
  readonly kind = 'squidward' as const;
  private readonly root: TransformNode;
  private readonly base: TransformNode; // the body's frame: tipped over when dead
  private readonly skin: SkinnedBody<Bone>;
  private readonly head: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legs: { node: TransformNode; side: 1 | -1; lag: number }[];
  private readonly grip: TransformNode; // the right hand, turned so a held item's barrel runs along the look
  private readonly reach: Vector3; // which way the arm hangs from the shoulder in the model
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly gait = new Gait();
  private dead = false;

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.base = new TransformNode(`avatar-body-${id}`, scene);
    this.base.parent = this.root;

    this.skin = new SkinnedBody(engine, `squidward-${id}`, SQUIDWARD_MODEL, TEXTURE, PARENTS, this.base);
    this.head = this.skin.node('head');
    this.armL = this.skin.node('armL');
    this.armR = this.skin.node('armR');
    this.legs = LEGS.map(({ bone, side, lag }) => ({ node: this.skin.node(bone), side, lag }));
    // Every part is an open shell: under the collar and up the sleeves you look into other parts.
    this.skin.material.backFaceCulling = false;
    this.skin.material.twoSidedLighting = true;
    this.hitFlash = new HitFlash([this.skin.material]);

    this.grip = new TransformNode(`avatar-grip-${id}`, scene);
    this.grip.parent = this.armR;
    this.grip.position.copyFrom(this.skin.offset('armR', SQUIDWARD_MODEL.hand));
    this.reach = this.grip.position.normalizeToNew();
    this.items = new HeldItems(
      engine,
      `squidward-${id}`,
      this.grip,
      Vector3.Zero(),
      this.skin.node('body'),
      this.skin.offset('body', SQUIDWARD_MODEL.back),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.5);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer, step: number): void {
    this.hitFlash.update();
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.x = p.pitch * HEAD_FOLLOW;

    this.gait.update(p.x, p.z, airborne, step);
    const { phase, effort } = this.gait;
    const swing = (lag: number) => (airborne ? 0.3 : Math.sin(phase - lag) * effort * LEG_SWING);
    for (const { node, side, lag } of this.legs) node.rotation.x = side * swing(lag);
    this.armL.rotation.x = (-swing(0) * ARM_SWING) / LEG_SWING;
    if (p.item && !p.dead) aimArm(this.armR, this.grip, this.reach, p.pitch);
    else {
      this.armR.rotationQuaternion = null;
      this.armR.rotation.x = (swing(0) * ARM_SWING) / LEG_SWING;
    }
    this.base.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * BOB * effort;
    this.base.rotation.z = airborne ? 0 : Math.sin(phase) * SWAY * effort;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Toppled onto his back, head away from where he was going, lifted by the head's depth so he
      // lies on the ground rather than through it.
      this.base.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.base.position.y = p.dead ? SQUIDWARD_MODEL.lie : 0;
    }
    if (p.dead) {
      this.base.rotation.z = 0;
      for (const { node } of this.legs) node.rotation.x = DEAD_LEGS;
      this.armR.rotationQuaternion = null;
      this.armL.rotation.x = this.armR.rotation.x = DEAD_ARMS;
      this.head.rotation.x = DEAD_HEAD;
      this.base.position.y = SQUIDWARD_MODEL.lie;
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
