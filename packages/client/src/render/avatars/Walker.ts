// Everything an avatar on foot does, posed onto whatever it is made of: standing, walking, aiming
// what it holds, falling, climbing a ladder (squared up to the rungs, stepping them with its legs
// and reaching up with its free hand, its weapon arm following the look, and swinging round the
// ladder on the hand holding it when its climber changes face) and lying dead. An avatar is a
// Figure: a builder makes its parts under the base node and says which plays each role and the
// numbers its walk takes, so a new way of moving is written here once and a new avatar is parts and
// numbers. Each phase (walk, climb, lie, aim) is a protected method: an avatar that moves by a rule
// of its own in one of them (a sidestep, a slither, tentacles wrapping the rungs) extends
// WalkerAvatar and overrides that phase, keeping the rest. The dragon is its own class (Dragon.ts).
import { Matrix, Mesh, Quaternion, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { EYE_HEIGHT, WORLD_STRUCTURES, walkSpeedOf, type AvatarId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

const RUNG = 0.3; // metres between a ladder's rungs (render/Structures.ts): a leg steps one at a time
const SWING_HALF_LIFE = 0.08; // seconds: the swing round a ladder is mostly over in a third of a second
const HEAD_TURN = 1.2; // radians a head may turn from the body on a ladder, where the body faces the rungs
const ARM_TURN = Math.PI / 2; // radians the weapon arm may turn from the body there: as far as the look is held
// Climbing: radians the legs are bent at the hip and swing from there, a knee up at each rung, and
// the elevation of a free hand's reach up the rungs, pumping with the legs.
const CLIMB_KNEE = 0.5;
const CLIMB_STEP = 0.45;
const CLIMB_REACH = 0.93;
const CLIMB_PUMP = 0.4;

export interface Leg {
  node: TransformNode; // swings at the hip
  side: 1 | -1; // with the stride, or against it
  // A lower half that swings `lag` radians of the stride behind the leg and `gain` times as far: a
  // tentacle bending as it goes, its foot flopping along after it.
  foot?: { node: TransformNode; lag: number; gain: number };
}

export interface Arm {
  node: TransformNode; // turns at the shoulder
  reach: Vector3; // unit, shoulder to hand as the model holds the arm: what pointing it turns from
}

// How a dead body lies.
export interface Lie {
  onto: 'back' | 'left' | 'right'; // which way it goes over
  height: number; // metres its base then sits above the ground: how deep the body is that way
  shift?: number; // metres the base moves along the body's x, so one tipped onto its side lies where it stood
  legs?: number; // radians the legs drop toward the ground
  arms?: number; // radians the arms turn to
  head?: number; // radians the head tips back
}

// What a walker avatar is made of and how it moves. The parts hang under the base node the
// builder is given; only the weapon arm is required, the rest an avatar has or hasn't.
export interface Figure {
  color?: string; // the player's colour it is painted in, when it is
  tilt?: { node: TransformNode; follow: number }; // what tips with the look's pitch, by that share of it: a head on a neck, or a trunk the face is on
  head?: TransformNode; // a head on a neck: turns to the look on a ladder
  legs?: Leg[];
  armL?: Arm; // swings against the legs, and reaches up the rungs on a ladder
  // Holds the item, which hangs on the grip at the hand, aimed along the look: by its own middle
  // there, or `hold` from it in the grip's frame (x to the right, y back along the barrel, z up),
  // for a fist that closes round the item's handle.
  armR: Arm & { grip: TransformNode; hold?: Vector3 };
  rock?: TransformNode; // what rocks to each side with the stride: the base unless given
  back: { node: TransformNode; at: Vector3 }; // where a tank and the gear hang
  materials: StandardMaterial[]; // the skin, flashed by a hit
  shadow: number; // metres across
  itemScale?: { weapons: number; packs: number }; // items drawn this much of their size, on a body far from a person's
  legSwing: number; // radians each leg swings each way at a full-speed walk
  airLegs: number; // radians the legs are held apart in the air
  armSwing: number; // radians the arms swing each way at a full-speed walk
  armsDown?: number; // radians the arms hang in toward the body from where the model holds them
  bob: number; // metres the body rises mid-stride
  sway?: number; // radians the body rocks to each side with the stride
  bend?: number; // radians the weapon arm stays below the look holding an item: an elbow bent, the item still along the look
  lie: Lie;
  extra?: (p: RemotePlayer, pose: Pose) => void; // the avatar's own touches, after the rest of the frame's pose
  dispose?: () => void; // anything of its own to let go of with its nodes
}

export interface Pose {
  phase: number; // the stride's, radians (Gait)
  effort: number; // how big the steps are, 0 to 1 (Gait): 0 on a ladder
  climbing: boolean;
}

export type Build = (engine: Engine, id: string, base: TransformNode, color: string) => Figure;

export class WalkerAvatar implements Avatar {
  protected readonly root: TransformNode; // at the feet, turned the way the body faces
  protected readonly base: TransformNode; // the body's frame: rises with the stride, lies over dead
  protected readonly figure: Figure;
  private readonly aimFrom: Vector3; // what the weapon arm turns from to aim: its reach, raised by the bend
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly shadow: Mesh;
  protected readonly gait = new Gait();
  protected climbPhase = 0; // radians along the rung-to-rung cycle of the legs
  private held: RemotePlayer['climb'] = null; // the ladder face last seen held
  private swing = 0; // radians the body has still to turn round the ladder after a swap
  private dead = false;
  private lastNow = performance.now();
  readonly color?: string;

  constructor(
    engine: Engine,
    readonly id: string,
    readonly kind: AvatarId,
    build: Build,
    color: string,
  ) {
    const scene = engine.scene;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.base = new TransformNode(`avatar-body-${id}`, scene);
    this.base.parent = this.root;
    this.figure = build(engine, id, this.base, color);
    const { armR, back, materials, shadow, itemScale, bend } = this.figure;
    this.color = this.figure.color;
    this.aimFrom = bend ? raised(armR.reach, bend) : armR.reach;
    this.hitFlash = new HitFlash(materials);
    const hold = armR.hold ?? Vector3.Zero();
    this.items = new HeldItems(engine, `${kind}-${id}`, kind, armR.grip, hold, back.node, back.at, itemScale);
    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, shadow);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer, step: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.hitFlash.update(p.chilled);
    const feetY = p.y - EYE_HEIGHT;
    const pose = p.climb && !p.dead ? this.climb(p, feetY, dt) : this.walk(p, feetY, step);
    if (p.dead) this.lie();
    this.dead = p.dead;
    this.figure.extra?.(p, pose);
    this.items.update(p);
    placeShadow(this.shadow, p, feetY);
    this.root.setEnabled(true);
  }

  // On the ground or in the air: the legs swing with the stride and the arms against them, the
  // body rising and rocking with it, the weapon arm pointed along the look while holding an item.
  protected walk(p: RemotePlayer, feetY: number, step: number): Pose {
    const f = this.figure;
    this.held = null;
    this.swing = 0;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.set(0, p.yaw, 0);
    const airborne = !p.grounded;
    this.gait.update(p.walk / walkSpeedOf(this.kind), airborne, step);
    const { phase, effort } = this.gait;
    // How far a limb is swung, as a share of its full swing: along the stride (a lower half `lag`
    // radians behind it), and in the air where the legs are held.
    const swung = (lag = 0) =>
      airborne ? (f.legSwing > 0 ? f.airLegs / f.legSwing : 0) : Math.sin(phase - lag) * effort;
    for (const leg of f.legs ?? []) {
      leg.node.rotation.x = leg.side * swung() * f.legSwing;
      if (leg.foot)
        leg.foot.node.rotation.x = leg.side * swung(leg.foot.lag) * leg.foot.gain * f.legSwing - leg.node.rotation.x;
    }
    const arms = swung() * f.armSwing;
    const armsDown = f.armsDown ?? 0;
    if (f.armL) {
      hang(f.armL.node);
      f.armL.node.rotation.x = -arms;
      f.armL.node.rotation.z = armsDown;
    }
    this.base.rotation.set(0, 0, 0);
    this.base.position.set(0, airborne ? 0 : Math.abs(Math.sin(phase)) * f.bob * effort, 0);
    (f.rock ?? this.base).rotation.z = airborne ? 0 : Math.sin(phase) * (f.sway ?? 0) * effort;
    if (f.tilt) f.tilt.node.rotation.x = p.pitch * f.tilt.follow;
    if (f.head) f.head.rotation.y = 0;
    if (p.item && !p.dead) this.aim(p);
    else {
      hang(f.armR.node);
      f.armR.node.rotation.x = arms;
      f.armR.node.rotation.z = -armsDown;
    }
    return { phase, effort, climbing: false };
  }

  // On a ladder: the body faces the rungs, the head turning with the look; the legs step rung to
  // rung at the climb's pace with the free hand reaching up against them, and the weapon arm
  // points where the look does, turning at the shoulder since the body can't. A change of face
  // swings the whole body half a turn round the ladder about the holding hand, easing to a stop
  // on the new side.
  protected climb(p: RemotePlayer, feetY: number, dt: number): Pose {
    const f = this.figure;
    const hold = p.climb!;
    const facing = WORLD_STRUCTURES.ladderFacing(hold.piece, hold.side);
    if (this.held && this.held.piece === hold.piece && this.held.side !== hold.side) this.swing -= hold.way * Math.PI;
    this.held = { ...hold };
    this.swing *= Math.pow(0.5, dt / SWING_HALF_LIFE);
    if (Math.abs(this.swing) < 1e-3) this.swing = 0;
    // Mid-swing the body is the way round the ladder's centre line that its turn has got to; and
    // it leans with the rails, its head toward where the ladder's top is over.
    const line = WORLD_STRUCTURES.ladderLine(hold.piece, feetY);
    const dx = p.x - line.x;
    const dz = p.z - line.z;
    const cos = Math.cos(this.swing);
    const sin = Math.sin(this.swing);
    this.root.position.set(line.x + dx * cos + dz * sin, feetY, line.z - dx * sin + dz * cos);
    this.root.rotation.y = facing + this.swing;
    this.root.rotation.x = -hold.side * WORLD_STRUCTURES.ladderLean(hold.piece);
    if (f.head) f.head.rotation.y = clamp(wrap(p.yaw - facing), HEAD_TURN);
    if (f.tilt) f.tilt.node.rotation.x = p.pitch * f.tilt.follow;
    this.base.rotation.set(0, 0, 0);
    this.base.position.set(0, 0, 0);
    if (f.rock) f.rock.rotation.z = 0;

    this.climbPhase += (p.walk / RUNG) * Math.PI * dt;
    const s = Math.sin(this.climbPhase);
    for (const leg of f.legs ?? []) {
      leg.node.rotation.x = -CLIMB_KNEE - leg.side * CLIMB_STEP * s;
      if (leg.foot) leg.foot.node.rotation.x = 0;
    }
    if (f.armL) point(f.armL, CLIMB_REACH - CLIMB_PUMP * s);
    if (p.item) this.aim(p);
    else point(f.armR, CLIMB_REACH + CLIMB_PUMP * s);
    return { phase: this.gait.phase, effort: 0, climbing: true };
  }

  // Dead: the base over onto its back or side, the limbs dropped.
  protected lie(): void {
    const f = this.figure;
    const { onto, height, shift = 0, legs = 0, arms = 0, head = 0 } = f.lie;
    if (f.tilt) f.tilt.node.rotation.x = 0;
    if (f.head) f.head.rotation.set(head, 0, 0);
    if (f.rock) f.rock.rotation.z = 0;
    for (const leg of f.legs ?? []) {
      leg.node.rotation.x = legs;
      if (leg.foot) leg.foot.node.rotation.x = 0;
    }
    for (const arm of [f.armL, f.armR]) {
      if (!arm) continue;
      hang(arm.node);
      arm.node.rotation.x = arms;
    }
    this.base.rotation.set(
      onto === 'back' ? -Math.PI / 2 : 0,
      0,
      onto === 'left' ? Math.PI / 2 : onto === 'right' ? -Math.PI / 2 : 0,
    );
    this.base.position.set(shift, height, 0);
  }

  // Points the weapon arm along the look, however the body stands (turned no further than
  // ARM_TURN from its front: mid-swing round a ladder the body hasn't come round to the look yet),
  // and turns the grip at its hand so the item's barrel (its -y) runs that way with its top (its
  // +z) up, whatever the model's hand is doing. The arm turns in its parent's frame, which may be
  // tipped with the look or rolling with the stride, so the look is taken into that frame first.
  // Nothing is allocated: this runs for every armed body every frame.
  protected aim(p: RemotePlayer): void {
    const { node, grip } = this.figure.armR;
    const turn = clamp(wrap(p.yaw - this.root.rotation.y), ARM_TURN);
    AHEAD.set(Math.sin(turn) * Math.cos(p.pitch), -Math.sin(p.pitch), Math.cos(turn) * Math.cos(p.pitch));
    UP.set(0, 1, 0);
    turnsBetween(node.parent as TransformNode, this.root, CHAIN).conjugateToRef(UNDO);
    AHEAD.applyRotationQuaternionInPlace(UNDO);
    UP.applyRotationQuaternionInPlace(UNDO);
    const swung = (node.rotationQuaternion ??= new Quaternion());
    Quaternion.FromUnitVectorsToRef(this.aimFrom, AHEAD, swung);
    // The grip's frame: x to the right, -y along the barrel, +z up its top; less the arm's own turn
    // (a quaternion product applies its right factor first).
    Vector3.CrossToRef(UP, AHEAD, RIGHT);
    RIGHT.normalize();
    Vector3.CrossToRef(AHEAD, RIGHT, TOP);
    Quaternion.FromRotationMatrixToRef(Matrix.FromXYZAxesToRef(RIGHT, AHEAD.negateToRef(DOWN_BARREL), TOP, AXES), HAND);
    swung.conjugateToRef(UNDO);
    UNDO.multiplyToRef(HAND, (grip.rotationQuaternion ??= new Quaternion()));
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
    this.figure.dispose?.();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.base) : null;
  }
}

// Scratch for the frame's arithmetic, shared by every walker: none of it survives a call.
const AHEAD = new Vector3();
const UP = new Vector3();
const RIGHT = new Vector3();
const TOP = new Vector3();
const DOWN_BARREL = new Vector3();
const CHAIN = new Quaternion();
const NODE = new Quaternion();
const UNDO = new Quaternion();
const HAND = new Quaternion();
const AXES = new Matrix();

// Points an arm straight out of the body's front at `elevation` radians above level.
export function point(arm: Arm, elevation: number): void {
  const turn = (arm.node.rotationQuaternion ??= new Quaternion());
  AHEAD.set(0, Math.sin(elevation), Math.cos(elevation));
  Quaternion.FromUnitVectorsToRef(arm.reach, AHEAD, turn);
}

// The turn that takes `node`'s frame into `root`'s, into `result`: every rotation on the way up
// the tree, the node's own first and each parent's after it, as the nodes are turned this frame
// (none of them scales). Cheaper than the world matrices, which the renderer hasn't built yet
// when a pose is set.
function turnsBetween(node: TransformNode, root: TransformNode, result: Quaternion): Quaternion {
  result.set(0, 0, 0, 1);
  for (let n: TransformNode | null = node; n && n !== root; n = n.parent as TransformNode | null) {
    if (n.rotationQuaternion) NODE.copyFrom(n.rotationQuaternion);
    else Quaternion.FromEulerAnglesToRef(n.rotation.x, n.rotation.y, n.rotation.z, NODE);
    NODE.multiplyToRef(result, result);
  }
  return result;
}

// Back to turning by the Euler angles in `rotation`, which a quaternion overrides.
export function hang(node: TransformNode): void {
  node.rotationQuaternion = null;
}

// `reach` turned up by `bend` radians in its own vertical plane.
function raised(reach: Vector3, bend: number): Vector3 {
  const elevation = Math.asin(reach.y) + bend;
  const azimuth = Math.atan2(reach.x, reach.z);
  return new Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
}

function clamp(a: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, a));
}

function wrap(angle: number): number {
  return ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}
