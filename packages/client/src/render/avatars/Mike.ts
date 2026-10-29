// Mike Wazowski (Monsters, Inc.): a 1.4 m green ball with one eye, on two short legs, from
// Guilherme Navarro's low-poly model (mikeModel.ts, made by scripts/monster-model.py), skinned over
// five bones: the ball (head and body in one), the arms and the legs. It scurries: quick little
// strides with the arms swinging against them and the ball bobbing, and the whole ball tips with the
// look, since that is where the eye is. A held item rides the right arm, which points forward to aim.
// It dies on its back with its limbs dropped. Worn with /mike or /wazowski; its hit capsule is sized
// to it (AVATARS.mike.hitbox), movement and items are everyone's.
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { MIKE_MODEL } from './mikeModel';
import { SkinnedBody } from './skinned';

const TEXTURE = '/assets/textures/avatars/mike.png';
const LEG_SWING = 0.7; // radians each way at a full-speed walk
const ARM_SWING = 0.45;
const BOB = 0.03; // metres the ball rises mid-stride
const LOOK_FOLLOW = 0.35; // how much of the look's pitch the ball tips by
// Lying on its back: radians the legs and arms drop toward the ground.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;

type Bone = keyof typeof MIKE_MODEL.bones;
const PARENTS: Record<Bone, Bone | null> = { ball: null, armL: 'ball', armR: 'ball', legL: 'ball', legR: 'ball' };

export class MikeAvatar implements Avatar {
  readonly kind = 'mike' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly skin: SkinnedBody<Bone>;
  private readonly ball: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private dead = false;
  private readonly gait = new Gait(6.5);

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    this.skin = new SkinnedBody(engine, `mike-${id}`, MIKE_MODEL, TEXTURE, PARENTS, this.body);
    this.ball = this.skin.node('ball');
    this.armL = this.skin.node('armL');
    this.armR = this.skin.node('armR');
    this.legL = this.skin.node('legL');
    this.legR = this.skin.node('legR');
    this.hitFlash = new HitFlash([this.skin.material]);

    // A held item goes in the right palm; the flamethrower's tank hangs on the back of the ball.
    this.items = new HeldItems(
      engine,
      `mike-${id}`,
      this.armR,
      this.skin.offset('armR', MIKE_MODEL.hand),
      this.ball,
      this.skin.offset('ball', MIKE_MODEL.back),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.1);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.ball.rotation.x = p.pitch * LOOK_FOLLOW;

    this.gait.update(p.x, p.z, airborne);
    const { phase, effort } = this.gait;
    const swing = airborne ? 0.4 : Math.sin(phase) * effort * LEG_SWING;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = (-swing * ARM_SWING) / LEG_SWING;
    // The arm is under the ball, so it only needs the rest of the pitch to aim where the look does.
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch * (1 - LOOK_FOLLOW) : (swing * ARM_SWING) / LEG_SWING;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * BOB * effort;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Toppled onto its back, head away from where it was going, lifted by the ball's radius so it
      // lies on the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? MIKE_MODEL.lie : 0;
    }
    if (p.dead) {
      this.legL.rotation.x = this.legR.rotation.x = DEAD_LEGS;
      this.armL.rotation.x = this.armR.rotation.x = DEAD_ARMS;
      this.ball.rotation.x = 0;
      this.body.position.y = MIKE_MODEL.lie;
    }
    placeShadow(this.shadow, p, feetY);
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
    this.skin.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.body) : null;
  }
}
