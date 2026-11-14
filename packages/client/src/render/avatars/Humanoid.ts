// A walker with a whole skeleton, moved in its own style: a trunk of hips, spine and chest under a
// head, arms that bend at the elbow and legs that bend at the knee, skinned from a model made by
// scripts/kart-model.py. Where the walker (Walker.ts) swings every body's limbs by one rule, this
// one is posed (motion.ts): each frame is a pose blended from its style's (standing, its stride at
// the pace it's going, rising, falling, landing), and the rig turns the pose into joint rotations,
// bending each leg to put its foot where the pose says. So two characters on this rig move as
// differently as their styles (Mario.ts, Luigi.ts), and a new one is a model and a style. The
// walker still places the body, counts its stride, aims what it holds and lays it down dead.
import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import { WORLD_STRUCTURES, walkSpeedOf, type AvatarId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import {
  ARM_ELBOW,
  ARM_GRIP,
  ARM_IN,
  ARM_L,
  ARM_OUT,
  ARM_R,
  ARM_SWING,
  CHEST_LEAN,
  CHEST_TILT,
  CHEST_TURN,
  FOOT_L,
  FOOT_PITCH,
  FOOT_R,
  FOOT_X,
  FOOT_Y,
  FOOT_YAW,
  FOOT_Z,
  HEAD_LEAN,
  HEAD_TILT,
  HEAD_TURN,
  HIP_LEAN,
  HIP_TILT,
  HIP_TURN,
  HIP_X,
  HIP_Y,
  HIP_Z,
  airPose,
  mix,
  pose,
  standPose,
  strideAt,
  stridePose,
  type BodyPose,
  type Stride,
  type Style,
} from './motion';
import { SkinnedBody, type SkinnedModel } from './skinned';
import { WalkerAvatar, type Figure, type Pose } from './Walker';

export type HumanBone =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'head'
  | 'armL'
  | 'forearmL'
  | 'handL'
  | 'fingersL'
  | 'thumbL'
  | 'armR'
  | 'forearmR'
  | 'handR'
  | 'fingersR'
  | 'thumbR'
  | 'legL'
  | 'shinL'
  | 'footL'
  | 'legR'
  | 'shinR'
  | 'footR';
const PARENTS: Record<HumanBone, HumanBone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  head: 'chest',
  armL: 'chest',
  forearmL: 'armL',
  handL: 'forearmL',
  fingersL: 'handL',
  thumbL: 'handL',
  armR: 'chest',
  forearmR: 'armR',
  handR: 'forearmR',
  fingersR: 'handR',
  thumbR: 'handR',
  legL: 'hips',
  shinL: 'legL',
  footL: 'shinL',
  legR: 'hips',
  shinR: 'legR',
  footR: 'shinR',
};

// A model on this rig, standing in a T-pose: its arms straight out to the sides, its legs straight down.
export interface HumanoidModel extends SkinnedModel<HumanBone> {
  readonly sole: readonly number[]; // metres a shoe's toe reaches ahead of its ankle, and its heel behind it
}

export interface HumanoidSpec {
  kind: AvatarId;
  model: HumanoidModel;
  style: Style;
  shadow: number; // metres across
}

const EASE_MOVING = 0.1; // seconds a body takes to settle from its stride into standing, and to pick it up
const EASE_TAKEOFF = 0.05; // seconds into its pose in the air
const EASE_TOUCHDOWN = 0.09; // and out of it
const EASE_DIRECTION = 0.09; // seconds its stride takes to come round to a new way of going
const MOVING = 0.4; // m/s across the floor that is going somewhere: under it the stride keeps the way it had
const JUMPED = 3; // metres moved in one frame that can only be a respawn or a correction
const HEAD_TURN_LIMIT = 1.2; // radians a head may turn from the body on a ladder, where the body faces the rungs
// On a ladder: the hips in toward it and the feet on its rungs, a rung apart, each stepping up as
// the other holds; the hands on the rails overhead, each reaching as its own foot steps.
const RUNG = 0.3; // metres between a ladder's rungs (render/Structures.ts)
const CLIMB = pose({
  hips: { z: 0.1, lean: 0.1 },
  chest: { lean: 0.15 },
  armL: { swing: 2.3, out: 0.25, elbow: 0.7, grip: 1 },
  armR: { swing: 2.3, out: 0.25, elbow: 0.7, grip: 1 },
  footL: { z: 0.3, y: RUNG / 2 + 0.05 },
  footR: { z: 0.3, y: RUNG / 2 + 0.05 },
});
// A fist: radians the fingers fold under the palm, and the thumb turns in and down after them.
const FINGER_CURL = 1.7;
const THUMB_FOLD = 0.6;
const THUMB_CURL = 1.3;
const CLIMB_REACH = 0.35; // radians a hand goes up and down the rail with each rung

export class HumanoidAvatar extends WalkerAvatar {
  private readonly rig: Rig;
  private readonly style: Style;
  private readonly stride: Stride;
  private readonly out = pose();
  private readonly other = pose();
  private last: { x: number; y: number; z: number; at: number } | null = null;
  private vy = 0; // m/s upward, as the body was last seen to move in the air
  private grounded = true;
  private dirX = 0; // the way it's going across the floor, in its own frame: its length under 1 through a change
  private dirZ = 1;
  private moving = 0; // how much of its stride it's in, the rest standing
  private airborne = 0; // how much of its pose in the air it's in
  private aloft = 0; // seconds since it left the ground
  private landed = 0; // how far into its landing crouch it is
  private stood = 0; // seconds it has been drawn, for its breath

  constructor(engine: Engine, id: string, kind: AvatarId, spec: HumanoidSpec, color: string) {
    let rig: Rig | undefined;
    super(
      engine,
      id,
      kind,
      (engine, id, base) => {
        rig = new Rig(engine, id, spec, base);
        return rig.figure;
      },
      color,
    );
    this.rig = rig!;
    this.style = spec.style;
    this.stride = { ...spec.style.strides[0] };
  }

  // On the ground or in the air: standing, striding at its pace the way it's going, or held in
  // the air, each eased into the next; a landing drops it toward its crouch by how fast it fell.
  protected override walk(p: RemotePlayer, feetY: number, step: number): Pose {
    const walked = super.walk(p, feetY, step);
    const dt = this.watch(p, feetY);
    const { style, out, other } = this;
    const pace = p.walk / walkSpeedOf(this.kind);
    this.moving = eased(this.moving, p.grounded && pace > 0.02 ? 1 : 0, dt, EASE_MOVING);
    standPose(out, style.stand, this.stood);
    if (this.moving > 0.001) {
      strideAt(this.stride, style.strides, pace);
      stridePose(other, this.stride, (step / 2) % 1, this.dirX, this.dirZ);
      mix(out, out, other, this.moving);
    }
    if (p.grounded && !this.grounded) this.landed = Math.min(1, Math.max(0, -this.vy) / style.landSpeed);
    this.grounded = p.grounded;
    if (p.grounded) this.vy = 0;
    this.landed *= Math.pow(0.5, dt / style.landSeconds);
    if (this.landed > 0.001) mix(out, out, style.land, this.landed);
    this.aloft = p.grounded ? 0 : this.aloft + dt;
    this.airborne = eased(this.airborne, p.grounded ? 0 : 1, dt, p.grounded ? EASE_TOUCHDOWN : EASE_TAKEOFF);
    if (this.airborne > 0.001) {
      airPose(other, style, this.vy, this.aloft);
      mix(out, out, other, this.airborne);
    }
    this.show(p);
    return walked;
  }

  // On a ladder, where the walker has put the body: feet stepping the rungs, hands going up the rails.
  protected override climb(p: RemotePlayer, feetY: number, dt: number): Pose {
    const climbed = super.climb(p, feetY, dt);
    this.watch(p, feetY);
    this.moving = this.airborne = this.landed = 0;
    const { out } = this;
    const s = Math.sin(this.climbPhase);
    out.set(CLIMB);
    out[FOOT_L + FOOT_Y] += (RUNG / 2) * s;
    out[FOOT_R + FOOT_Y] -= (RUNG / 2) * s;
    out[ARM_L + ARM_SWING] += CLIMB_REACH * s;
    out[ARM_R + ARM_SWING] -= CLIMB_REACH * s;
    const facing = WORLD_STRUCTURES.ladderFacing(p.climb!.piece, p.climb!.side);
    out[HEAD_TURN] = Math.max(-HEAD_TURN_LIMIT, Math.min(HEAD_TURN_LIMIT, wrap(p.yaw - facing)));
    this.show(p);
    return climbed;
  }

  protected override lie(): void {
    super.lie();
    this.rig.apply(this.style.dead);
  }

  // The frame's pose onto the rig, the head tipped with the look and the weapon arm, straight, along it.
  private show(p: RemotePlayer): void {
    this.out[HEAD_LEAN] += p.pitch * this.style.follow;
    this.rig.apply(this.out);
    if (p.item && !p.dead) {
      this.rig.straighten();
      this.aim(p);
    }
  }

  // How the body has moved since it was last drawn: its rise or fall, and the way it's going across
  // the floor in its own frame. Returns the seconds since.
  private watch(p: RemotePlayer, feetY: number): number {
    const now = performance.now() / 1000;
    const last = this.last;
    this.last = { x: p.x, y: feetY, z: p.z, at: now };
    if (!last) return 0;
    const dt = Math.min(0.1, now - last.at);
    this.stood += dt;
    const dx = p.x - last.x;
    const dz = p.z - last.z;
    if (dt <= 0 || Math.hypot(dx, dz, feetY - last.y) > JUMPED) return dt;
    if (!p.grounded) this.vy = (feetY - last.y) / dt;
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const right = (dx * cos - dz * sin) / dt;
    const ahead = (dx * sin + dz * cos) / dt;
    const speed = Math.hypot(right, ahead);
    if (speed > MOVING) {
      this.dirX = eased(this.dirX, right / speed, dt, EASE_DIRECTION);
      this.dirZ = eased(this.dirZ, ahead / speed, dt, EASE_DIRECTION);
    }
    return dt;
  }
}

// `value` on its way to `target`, `dt` seconds on, most of the way there after `seconds`.
function eased(value: number, target: number, dt: number, seconds: number): number {
  return value + (target - value) * (1 - Math.exp((-3 * dt) / seconds));
}

function wrap(angle: number): number {
  return ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

// The skeleton: the model's skin on its bones, what the walker needs of them, and the pose solver.
class Rig {
  readonly figure: Figure;
  private readonly skin: SkinnedBody<HumanBone>;
  private readonly hipsAt: Vector3; // the hips' pivot, standing
  private readonly thigh: number; // metres, hip to knee
  private readonly shin: number; // knee to ankle
  private readonly ankle: number; // metres the ankle stands off the ground
  private readonly toe: number;
  private readonly heel: number;
  // Each leg's hip joint from the hips' pivot, and where its ankle stands.
  private readonly hipL: Vector3;
  private readonly hipR: Vector3;
  private readonly standL: Vector3;
  private readonly standR: Vector3;

  constructor(engine: Engine, id: string, spec: HumanoidSpec, base: TransformNode) {
    const { kind, model } = spec;
    const skin = new SkinnedBody(engine, `${kind}-${id}`, model, kind, PARENTS, base);
    this.skin = skin;
    const at = (bone: HumanBone) => Vector3.FromArray(model.bones[bone] as number[]);
    this.hipsAt = at('hips');
    this.thigh = Vector3.Distance(at('legR'), at('shinR'));
    this.shin = Vector3.Distance(at('shinR'), at('footR'));
    this.ankle = model.bones.footR[1];
    [this.toe, this.heel] = model.sole;
    this.hipL = at('legL').subtract(this.hipsAt);
    this.hipR = at('legR').subtract(this.hipsAt);
    this.standL = at('footL');
    this.standR = at('footR');

    // A held item goes in the right palm, which the walker points along the look from the shoulder:
    // the arm's own length, straight, is its reach.
    const armR = skin.node('armR');
    const hand = skin.node('handR');
    const grip = new TransformNode(`avatar-grip-${id}`, engine.scene);
    grip.parent = hand;
    grip.position.copyFrom(skin.offset('handR', model.hand));
    const chest = skin.node('chest');
    this.figure = {
      armR: { node: armR, grip, reach: at('handR').subtract(at('armR')).normalize() },
      back: { node: chest, at: skin.offset('chest', model.back) },
      materials: [skin.material],
      shadow: spec.shadow,
      // The walker's own swings are none: every limb is posed here.
      legSwing: 0,
      airLegs: 0,
      armSwing: 0,
      bob: 0,
      lie: { onto: 'back', height: model.lie },
      dispose: () => skin.dispose(),
    };
  }

  // Turns every joint to `pose`. The trunk's turns are the body's frame's, so each is taken into its
  // parent's; a leg is the two-bone triangle from its hip joint to where the pose puts its ankle,
  // the knee bent the way the foot points.
  apply(pose: BodyPose): void {
    const hips = this.skin.node('hips');
    hips.position.set(this.hipsAt.x + pose[HIP_X], this.hipsAt.y + pose[HIP_Y], this.hipsAt.z + pose[HIP_Z]);
    turned(pose[HIP_TURN], pose[HIP_LEAN], pose[HIP_TILT], HIPS);
    set(hips, HIPS);
    turned(pose[CHEST_TURN], pose[CHEST_LEAN], pose[CHEST_TILT], CHEST);
    Quaternion.SlerpToRef(HIPS, CHEST, 0.5, SPINE);
    within(HIPS, SPINE, this.skin.node('spine'));
    within(SPINE, CHEST, this.skin.node('chest'));
    turned(pose[HEAD_TURN], pose[HEAD_LEAN], pose[HEAD_TILT], HEAD);
    within(CHEST, HEAD, this.skin.node('head'));
    this.arm(pose, ARM_L, -1, 'armL', 'forearmL', 'handL', 'fingersL', 'thumbL');
    this.arm(pose, ARM_R, 1, 'armR', 'forearmR', 'handR', 'fingersR', 'thumbR');
    this.leg(pose, FOOT_L, hips, this.hipL, this.standL, 'legL', 'shinL', 'footL');
    this.leg(pose, FOOT_R, hips, this.hipR, this.standR, 'legR', 'shinR', 'footR');
  }

  // The weapon arm from the shoulder down as the model holds it, straight, its hand closed on the
  // grip: what the walker aims.
  straighten(): void {
    set(this.skin.node('forearmR'), IDENTITY);
    set(this.skin.node('handR'), IDENTITY);
    this.hand(1, 1, 'fingersR', 'thumbR');
  }

  // An arm the model holds straight out to `side`: turned about its own length, then down to
  // hanging less how far it's held out, then swung ahead; the elbow bends the forearm the way a
  // hanging arm's faces, forward.
  private arm(
    pose: BodyPose,
    at: number,
    side: 1 | -1,
    upper: HumanBone,
    fore: HumanBone,
    hand: HumanBone,
    fingers: HumanBone,
    thumb: HumanBone,
  ): void {
    Quaternion.RotationYawPitchRollToRef(0, -pose[at + ARM_SWING], -side * (Math.PI / 2 - pose[at + ARM_OUT]), A);
    Quaternion.RotationAxisToRef(Vector3.RightReadOnly, pose[at + ARM_IN], B);
    set(this.skin.node(upper), A.multiplyInPlace(B));
    Quaternion.RotationAxisToRef(Vector3.UpReadOnly, -side * pose[at + ARM_ELBOW], A);
    set(this.skin.node(fore), A);
    set(this.skin.node(hand), IDENTITY);
    this.hand(side, pose[at + ARM_GRIP], fingers, thumb);
  }

  // The hand the model holds flat, palm down, closed `grip` of the way to a fist: the fingers fold
  // under it at the knuckles and the thumb comes round under them.
  private hand(side: 1 | -1, grip: number, fingers: HumanBone, thumb: HumanBone): void {
    Quaternion.RotationAxisToRef(Vector3.LeftHandedForwardReadOnly, -side * FINGER_CURL * grip, A);
    set(this.skin.node(fingers), A);
    Quaternion.RotationYawPitchRollToRef(-side * THUMB_FOLD * grip, THUMB_CURL * grip, 0, A);
    set(this.skin.node(thumb), A);
  }

  private leg(
    pose: BodyPose,
    at: number,
    hips: TransformNode,
    joint: Vector3,
    stand: Vector3,
    upper: HumanBone,
    lower: HumanBone,
    foot: HumanBone,
  ): void {
    // The hip joint, where the hips have been put and turned.
    joint.rotateByQuaternionToRef(HIPS, HIP).addInPlace(hips.position);
    // The ankle over where the sole is put: a foot tipped onto its toe or its heel stands on that.
    const pitch = pose[at + FOOT_PITCH];
    const tip = (pitch > 0 ? this.toe : this.heel) * Math.abs(Math.sin(pitch));
    ANKLE.set(
      stand.x + pose[at + FOOT_X],
      pose[at + FOOT_Y] + this.ankle * Math.cos(pitch) + tip,
      stand.z + pose[at + FOOT_Z],
    );
    const yaw = pose[at + FOOT_YAW];
    FORWARD.set(Math.sin(yaw), 0, Math.cos(yaw));
    // The leg's triangle: hip to ankle is one side, no longer than the leg straight and no shorter
    // than it folded, and the knee is off that line on the side the foot points.
    ANKLE.subtractToRef(HIP, DOWN);
    const far = this.thigh + this.shin - 1e-4;
    const near = Math.abs(this.thigh - this.shin) + 1e-4;
    const span = Math.min(far, Math.max(near, DOWN.length()));
    DOWN.normalize();
    Vector3.CrossToRef(FORWARD, DOWN, HINGE);
    if (HINGE.lengthSquared() < 1e-8) HINGE.copyFrom(Vector3.RightReadOnly);
    HINGE.normalize();
    Vector3.CrossToRef(DOWN, HINGE, KNEEWARD);
    const cos = (this.thigh * this.thigh + span * span - this.shin * this.shin) / (2 * this.thigh * span);
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    // Hip to knee and knee to ankle, each bone's frame its length up it with the knee's hinge across.
    DOWN.scaleToRef(this.thigh * cos, KNEE).addInPlace(KNEEWARD.scaleToRef(this.thigh * sin, STEP));
    DOWN.scaleToRef(span, STEP).subtractInPlace(KNEE);
    framed(KNEE, THIGH);
    framed(STEP, SHIN);
    within(HIPS, THIGH, this.skin.node(upper));
    within(THIGH, SHIN, this.skin.node(lower));
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, A);
    within(SHIN, A, this.skin.node(foot));
  }
}

// Scratch for the frame's arithmetic, shared by every humanoid: none of it survives a call.
const IDENTITY = Quaternion.Identity();
const HIPS = new Quaternion();
const SPINE = new Quaternion();
const CHEST = new Quaternion();
const HEAD = new Quaternion();
const THIGH = new Quaternion();
const SHIN = new Quaternion();
const A = new Quaternion();
const B = new Quaternion();
const HIP = new Vector3();
const ANKLE = new Vector3();
const FORWARD = new Vector3();
const DOWN = new Vector3();
const HINGE = new Vector3();
const KNEEWARD = new Vector3();
const KNEE = new Vector3();
const STEP = new Vector3();
const UP = new Vector3();
const AHEAD = new Vector3();

// A turn in the body's frame: to the right, leaning forward, tilted right side down.
function turned(turn: number, lean: number, tilt: number, result: Quaternion): void {
  Quaternion.RotationYawPitchRollToRef(turn, lean, -tilt, result);
}

function set(node: TransformNode, turn: Quaternion): void {
  (node.rotationQuaternion ??= new Quaternion()).copyFrom(turn);
}

// Gives `node` the turn that, under a parent turned `parent`, leaves it turned `turn` (a
// quaternion product applies its right factor first).
function within(parent: Quaternion, turn: Quaternion, node: TransformNode): void {
  parent.conjugateToRef(B);
  B.multiplyToRef(turn, (node.rotationQuaternion ??= new Quaternion()));
}

// The turn of a leg bone that runs along `down` from its joint, HINGE across it: its frame's y back
// up the bone, its x the hinge.
function framed(down: Vector3, result: Quaternion): void {
  down.scaleToRef(-1 / down.length(), UP);
  Vector3.CrossToRef(HINGE, UP, AHEAD);
  Quaternion.RotationQuaternionFromAxisToRef(HINGE, UP, AHEAD, result);
}
