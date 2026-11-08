// The standard avatar: a blocky figure in the player's colour with a glowing visor, a shadow on
// the ground, and a walk cycle driven by how far they moved. On a ladder it squares up to the
// rungs and climbs them, and swings round the ladder on the hand holding it when its climber
// changes face. No outline pass: thin lines shimmer at the reduced render resolution.
import { Color3, Mesh, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT, WORLD_STRUCTURES } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { box, centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

const RUNG = 0.3; // metres between a ladder's rungs (render/Structures.ts): a leg steps one at a time
const SWING_HALF_LIFE = 0.08; // seconds: the swing round a ladder is mostly over in a third of a second
const HEAD_TURN = 1.2; // radians the head may turn from the body on a ladder, where the body faces the rungs

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
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private dead = false;
  private readonly gait = new Gait();
  private climbPhase = 0; // radians along the rung-to-rung cycle of the legs
  private held: { piece: number; side: 1 | -1 } | null = null; // the ladder face last seen held
  private swing = 0; // radians the body has still to turn round the ladder after a swap
  private lastNow = performance.now();

  constructor(
    engine: Engine,
    readonly id: string,
    readonly color: string,
  ) {
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
    this.items = new HeldItems(
      engine,
      `avatar-${id}`,
      'standard',
      this.armR,
      new Vector3(0, -0.32, 0.04),
      this.body,
      new Vector3(0, 1.12, -0.28),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.1);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer, step: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.hitFlash.update(p.chilled);
    const feetY = p.y - EYE_HEIGHT;
    if (p.climb && !p.dead) {
      this.climbLadder(p, feetY, dt);
      return;
    }
    this.held = null;
    this.swing = 0;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.y = 0;
    this.head.rotation.x = p.pitch * 0.6;

    this.gait.update(p.walk, airborne, step);
    const { phase, effort } = this.gait;
    const swing = airborne ? 0.35 : Math.sin(phase) * effort * 0.7;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : swing * 0.8;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * 0.04 * effort;
    this.items.update(p);
    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen: the whole body tipped onto its side.
      this.body.rotation.z = p.dead ? Math.PI / 2 : 0;
      this.body.position.x = p.dead ? 0.3 : 0;
    }
    if (p.dead) {
      this.legL.rotation.x = this.legR.rotation.x = this.armL.rotation.x = 0;
      this.body.position.y = 0.3;
    }
    placeShadow(this.shadow, p, feetY);
    this.root.setEnabled(true);
  }

  // On a ladder: the body faces the rungs, the head turning with the look; the legs step rung to
  // rung at the climb's pace with the free hand reaching up against them, and the weapon hand
  // aims as ever. A change of face swings the whole body half a turn round the ladder about the
  // holding hand, easing to a stop on the new side.
  private climbLadder(p: RemotePlayer, feetY: number, dt: number): void {
    const hold = p.climb!;
    const facing = WORLD_STRUCTURES.ladderFacing(hold.piece, hold.side);
    if (this.held && this.held.piece === hold.piece && this.held.side !== hold.side) this.swing -= Math.PI;
    this.held = { ...hold };
    this.swing *= Math.pow(0.5, dt / SWING_HALF_LIFE);
    if (Math.abs(this.swing) < 1e-3) this.swing = 0;
    // Mid-swing the body is the way round the ladder's centre line that its turn has got to.
    const ladder = WORLD_STRUCTURES.list[hold.piece];
    const dx = p.x - ladder.x;
    const dz = p.z - ladder.z;
    const cos = Math.cos(this.swing);
    const sin = Math.sin(this.swing);
    this.root.position.set(ladder.x + dx * cos + dz * sin, feetY, ladder.z - dx * sin + dz * cos);
    this.root.rotation.y = facing + this.swing;
    const turn = ((p.yaw - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.head.rotation.y = Math.max(-HEAD_TURN, Math.min(HEAD_TURN, turn));
    this.head.rotation.x = p.pitch * 0.6;

    this.climbPhase += (p.walk / RUNG) * Math.PI * dt;
    const s = Math.sin(this.climbPhase);
    this.legL.rotation.x = -0.5 - 0.45 * s;
    this.legR.rotation.x = -0.5 + 0.45 * s;
    this.armL.rotation.x = -2.5 + 0.4 * s;
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : -2.5 - 0.4 * s;
    this.body.position.y = 0;
    this.items.update(p);
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
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.body) : null;
  }
}
