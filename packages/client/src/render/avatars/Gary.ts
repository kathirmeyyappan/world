// Gary, SpongeBob's snail: a soft body with a foot along its underside, a shell on its back and
// his eyes on stalks at the front, from Anthony Yanez's model (garyModel.ts, made by
// scripts/avatar-model.py) and skinned over a handful of bones. He has no arms or legs, so nothing
// holds an item: it sits by the right of his eyes, aimed along the look, and his packs go on the
// top of his shell. He walks with no footsteps: a ripple runs along his foot instead.
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { GARY_MODEL } from './garyModel';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SkinnedBody } from './skinned';

type GaryBone = 'body' | 'shell' | 'eyes' | 'foot0' | 'foot1' | 'foot2' | 'foot3' | 'foot4';
const FOOT = ['foot0', 'foot1', 'foot2', 'foot3', 'foot4'] as const; // back to front
const PARENTS: Record<GaryBone, GaryBone | null> = {
  body: null,
  shell: 'body',
  eyes: 'body',
  foot0: 'body',
  foot1: 'body',
  foot2: 'body',
  foot3: 'body',
  foot4: 'body',
};

// How much of the look's pitch the eyes take; a held item takes the rest, so it still aims along the look.
const FOLLOW = 0.5;
const RIPPLE = 0.2; // radians each band of the foot tips up and down at full stride, the ripple's crest
const WAVE = Math.PI / 2; // radians of ripple phase from one band of the foot to the next: a wave across it
// The weapon's grip in the eyes' frame, metres: beside the right eye and a little in front of it.
const GRIP = new Vector3(0.14, -0.02, 0.1);
// Drawn this much of their size, to fit his body: the guns and the packs were made for a person.
const WEAPON_SCALE = 0.6;
const PACK_SCALE = 0.5;
const PACK_LIFT = 0.16; // metres the packs' centres sit above the top of the shell, so their bottoms rest on it

export class GaryAvatar implements Avatar {
  readonly kind = 'gary' as const;
  private readonly root: TransformNode;
  private readonly base: TransformNode; // the body's frame: lies over when dead
  private readonly skin: SkinnedBody<GaryBone>;
  private readonly eyes: TransformNode;
  private readonly feet: TransformNode[];
  // On the right of his eyes, turned so a held item's barrel runs along the look.
  private readonly grip: TransformNode;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly gait: Gait;
  private dead = false;

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    this.gait = new Gait();
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.base = new TransformNode(`avatar-body-${id}`, scene);
    this.base.parent = this.root;

    this.skin = new SkinnedBody(engine, `gary-${id}`, GARY_MODEL, 'gary', PARENTS, this.base);
    this.eyes = this.skin.node('eyes');
    this.feet = FOOT.map((bone) => this.skin.node(bone));
    // The foot and stalks are open sheets in the model, so they are drawn from both sides.
    this.skin.material.backFaceCulling = false;
    this.skin.material.twoSidedLighting = true;
    this.hitFlash = new HitFlash([this.skin.material]);

    this.grip = new TransformNode(`avatar-grip-${id}`, scene);
    this.grip.parent = this.eyes;
    this.grip.position.copyFrom(GRIP);
    // The packs hang off the shell, which never moves, so they stay on its top as he crawls.
    const pack = this.skin.offset('shell', GARY_MODEL.back);
    pack.y += PACK_LIFT;
    this.items = new HeldItems(engine, `gary-${id}`, 'gary', this.grip, Vector3.Zero(), this.skin.node('shell'), pack, {
      weapons: WEAPON_SCALE,
      packs: PACK_SCALE,
    });

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 0.7);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer, step: number): void {
    this.hitFlash.update(p.chilled);
    const feetY = p.y - EYE_HEIGHT;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;

    this.gait.update(p.x, p.z, !p.grounded, step);
    const { phase, effort } = this.gait;
    const ripple = p.grounded && !p.dead ? effort : 0;
    this.eyes.rotation.x = p.pitch * FOLLOW;
    this.feet.forEach((foot, i) => {
      foot.rotation.x = RIPPLE * ripple * Math.sin(phase + i * WAVE);
    });
    this.grip.rotation.x = p.item && !p.dead ? p.pitch * (1 - FOLLOW) - Math.PI / 2 : 0;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Lying on its back, lifted by the body's depth so it rests on the ground rather than through it.
      this.base.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.base.position.y = p.dead ? GARY_MODEL.lie : 0;
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
