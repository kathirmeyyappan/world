// Sulley (Monsters, Inc.): 2.6 m of teal fur with purple spots, from Guilherme Navarro's low-poly
// model (sulleyModel.ts, made by scripts/monster-model.py), skinned over eight bones: hips, chest,
// head, the arms, the legs and the tail. It lumbers: short legs stride, the long arms swing against
// them, the chest rolls, the tail sways on its own, and the head follows the look. A held item rides
// the right arm, which points forward to aim. It dies flat on its back with the tail out to one side.
// Worn with /sulley; its hit capsule is sized to it (AVATARS.sulley.hitbox), movement and items are
// everyone's.
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SkinnedBody } from './skinned';
import { SULLEY_MODEL } from './sulleyModel';

const TEXTURE = '/assets/textures/avatars/sulley.png';
const LEG_SWING = 0.55; // radians each way at a full-speed walk
const ARM_SWING = 0.3;
const ROLL = 0.06; // radians the chest rolls side to side with each stride
const BOB = 0.04; // metres the body rises mid-stride
const HEAD_FOLLOW = 0.5; // how much of the look's pitch the head takes
const TAIL_SWAY = 0.25; // radians each way, all the time
const TAIL_SWAY_MS = 1600;
// Lying on its back: radians the legs and arms drop toward the ground and the head tips back.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;
const DEAD_HEAD = -0.4;

type Bone = keyof typeof SULLEY_MODEL.bones;
const PARENTS: Record<Bone, Bone | null> = {
  hips: null,
  chest: 'hips',
  head: 'chest',
  armL: 'chest',
  armR: 'chest',
  legL: 'hips',
  legR: 'hips',
  tail: 'hips',
};

export class SulleyAvatar implements Avatar {
  readonly kind = 'sulley' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly skin: SkinnedBody<Bone>;
  private readonly chest: TransformNode;
  private readonly head: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly tail: TransformNode;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly swayOffset: number;
  private dead = false;
  private readonly gait = new Gait(4.2);

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    this.swayOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TAIL_SWAY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    this.skin = new SkinnedBody(engine, `sulley-${id}`, SULLEY_MODEL, TEXTURE, PARENTS, this.body);
    this.chest = this.skin.node('chest');
    this.head = this.skin.node('head');
    this.armL = this.skin.node('armL');
    this.armR = this.skin.node('armR');
    this.legL = this.skin.node('legL');
    this.legR = this.skin.node('legR');
    this.tail = this.skin.node('tail');
    this.hitFlash = new HitFlash([this.skin.material]);

    // A held item goes in the right palm; the flamethrower's tank hangs on the back below the shoulders.
    this.items = new HeldItems(
      engine,
      `sulley-${id}`,
      this.armR,
      this.skin.offset('armR', SULLEY_MODEL.hand),
      this.chest,
      this.skin.offset('chest', SULLEY_MODEL.back),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.7);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.x = p.pitch * HEAD_FOLLOW;

    this.gait.update(p.x, p.z, airborne);
    const { phase, effort } = this.gait;
    const swing = airborne ? 0.3 : Math.sin(phase) * effort * LEG_SWING;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = (-swing * ARM_SWING) / LEG_SWING;
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : (swing * ARM_SWING) / LEG_SWING;
    this.chest.rotation.z = airborne ? 0 : Math.sin(phase) * ROLL * effort;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * BOB * effort;
    this.tail.rotation.y = Math.sin(((performance.now() + this.swayOffset) / TAIL_SWAY_MS) * 2 * Math.PI) * TAIL_SWAY;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Toppled onto its back, head away from where it was going, the hips as high as the body is
      // deep so it lies on the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? SULLEY_MODEL.lie : 0;
    }
    if (p.dead) {
      // Limbs dropped to the ground either side, the head back, the tail out of the floor.
      this.legL.rotation.x = this.legR.rotation.x = DEAD_LEGS;
      this.armL.rotation.x = this.armR.rotation.x = DEAD_ARMS;
      this.head.rotation.x = DEAD_HEAD;
      this.chest.rotation.z = 0;
      this.body.position.y = SULLEY_MODEL.lie;
      this.tail.rotation.y = Math.PI / 2;
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
