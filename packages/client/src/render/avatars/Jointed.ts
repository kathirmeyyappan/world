// A walker with a whole skeleton, moved by animation: a trunk of hips, spine and chest under a
// head, arms that bend at the elbow and legs that bend at the knee, skinned from a model made by
// scripts/jointed-model.py. Where the walker (Walker.ts) swings every body's limbs by one rule, this
// one plays clips (clips.ts): each frame is its idle, its walk or run at the point in the stride
// its feet have got to, its jump, its fall and its landing, blended from one into the next. So it
// moves as whoever animated the clips moved it, and a new character is a model and its clips. The
// walker still places the body, counts its stride, aims what it holds and lays it down dead.
import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import { GRAVITY, WORLD_STRUCTURES, walkSpeedOf, type AvatarId } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { CLIP_BONES, LEGS, blend, clip, motion, sample, turnAt, type Clip, type Motion, type RawClip } from './clips';
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
  pose,
  smooth,
  type BodyPose,
} from './motion';
import { SkinnedBody, type SkinnedModel } from './skinned';
import { WalkerAvatar, type Figure, type Pose } from './Walker';

export type JointedBone =
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
const PARENTS: Record<JointedBone, JointedBone | null> = {
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
export interface JointedModel extends SkinnedModel<JointedBone> {
  readonly sole: readonly number[]; // metres a shoe's toe reaches ahead of its ankle, and its heel behind it
}

// How a character moves: its clips, and the few numbers round them.
export interface Style {
  clips: {
    idle: RawClip; // standing, looped
    walk: RawClip; // a stride at a slow walk, starting as the right foot comes down
    run: RawClip; // and at a run
    jump: RawClip; // leaving the ground, held at its end while it's going up
    fall: RawClip; // coming down, looped
    land: RawClip; // from the bottom of a landing's crouch back up to standing
    leap?: RawClip; // a long jump (sim/avatars.ts `Leap`), takeoff to landing: held at its end
  };
  flutter?: number; // strides a second its legs run on at in the air: a scuttle
  landSpeed: number; // m/s of fall that lands all the way into the landing's crouch
  dead: BodyPose; // lying on its back
  follow: number; // the share of the look's pitch the head takes
  bank: number; // radians it leans into a turn for each radian a second it's turning, at a full walk
}

export interface JointedSpec {
  kind: AvatarId;
  model: JointedModel;
  style: Style;
  shadow: number; // metres across
}

// The share of its full walk under which a body walks and over which it runs, the stride between
// being a blend of the two: the run comes in early, as it does in the games the clips are from.
const WALKS = 0.3;
const RUNS = 0.45;
const EASE_MOVING = 0.1; // seconds a body takes to settle from its stride into standing, and to pick it up
// Seconds into its pose in the air, out of it, and over the top of a jump from going up to coming
// down: each from rest to rest, so no pose is snapped to in a frame.
const TAKEOFF_SECONDS = 0.12;
const TOUCHDOWN_SECONDS = 0.12;
const APEX_SECONDS = 0.28;
const LAND_IN = 0.05; // seconds a landing takes to drop into its crouch
const EASE_DIRECTION = 0.09; // seconds its stride takes to come round to a new way of going
const EASE_TURN = 0.12; // seconds its body takes to come round to face the way it's going
const EASE_AIM = 0.06; // and to face its look, with something in its hand to aim
const EASE_KICKING = 0.15; // seconds its legs take to stop fluttering as a jet takes its weight, and to start again
const EASE_BANK = 0.15; // seconds it takes to lean into a turn, and to come back up out of one
const MAX_BANK = 0.3; // radians it leans into the sharpest turn
// Facing its look with its feet going another way, its hips turn toward the way they're going by
// up to SIDESTEP radians and its chest back by as much; past BACKPEDAL from ahead it runs backward.
const SIDESTEP = 1.1;
const BACKPEDAL = 2;
const MOVING = 0.4; // m/s across the floor that is going somewhere: under it the body keeps the way it had
// Metres that is moving: a player's own body drifts by less on every frame, as its prediction's
// correction dies away, and that isn't a step of the sim.
const MOVED = 1e-3;
const STILL = 0.1; // seconds without moving that is standing still, not waiting on the sim's next tick
const JUMPED = 3; // metres moved at once that can only be a respawn or a correction
const HEAD_TURN_LIMIT = 1.2; // radians a head may turn from the way the body faces
// A head turns to the look while the look is within HEAD_GIVES_UP radians of the way the body
// faces, less and less over the last HEAD_FADE of that: running back toward the eye, it looks ahead.
const HEAD_GIVES_UP = 2.4;
const HEAD_FADE = 0.8;
// How closed its hands are: loose standing, fists running and jumping, open coming down.
const GRIP_IDLE = 0.3;
const GRIP_RUN = 1;
const GRIP_FALL = 0.2;
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
const FIST = 0.05; // metres a fist's middle is from the palm's, on the palm's side
// Where a held item's own origin (the top of its handle) goes from the fist's middle, in the grip's
// frame: the handle's middle in the fist, so the barrel runs over the top of the hand.
const HOLD = new Vector3(0, 0.02, 0.06);
const CLIMB_REACH = 0.35; // radians a hand goes up and down the rail with each rung

export class JointedAvatar extends WalkerAvatar {
  private readonly rig: Rig;
  private readonly style: Style;
  private readonly clips: Record<Exclude<keyof Style['clips'], 'leap'>, Clip> & { leap: Clip | null };
  private readonly out = motion();
  private readonly other = motion();
  private readonly third = motion();
  private readonly rungs = pose(); // a pose worked out, not played: on a ladder
  private drawn: number | null = null; // when it was last drawn, seconds
  private last: { x: number; y: number; z: number; at: number } | null = null; // where it last moved to, and when
  private velX = 0; // m/s across the floor, in the world, as it last moved
  private velZ = 0;
  private sinking = false; // whether it last moved down
  private peak = 0; // the highest its feet have been since it left the ground, metres
  private falling = 0; // how far over the top of its jump it is: 0 going up, 1 coming down
  private grounded = true;
  private facing = 0; // the way the body faces, radians in the world: the root's yaw
  private bank = 0; // radians it's leaning into a turn, to its right
  private dirX = 0; // the way it's going across the floor, in its own frame: its length under 1 through a change
  private dirZ = 1;
  private moving = 0; // how much of its stride it's in, the rest standing
  private airborne = 0; // how far into its pose in the air it is: 0 on the ground, 1 well off it
  private aloft = 0; // seconds since it left the ground
  private kicking = 1; // how much of its flutter its legs have in the air: none under a jet's thrust
  private leaping = 0; // how far into its long jump's pose it is, of its poses in the air
  private impact = 0; // how hard it last landed, 0 to 1
  private landing = Infinity; // seconds since it last landed
  private stood = 0; // seconds it has been drawn, for its idle

  constructor(engine: Engine, id: string, kind: AvatarId, spec: JointedSpec, color: string) {
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
    const raw = spec.style.clips;
    this.clips = {
      idle: clip(raw.idle),
      walk: clip(raw.walk),
      run: clip(raw.run),
      jump: clip(raw.jump),
      fall: clip(raw.fall),
      land: clip(raw.land),
      leap: raw.leap ? clip(raw.leap) : null,
    };
  }

  // On the ground or in the air: its idle, its walk or run where its stride has got to, its jump,
  // its fall and its landing, each blended into the next. Empty-handed the body turns to face the
  // way it's going, leaning into the turn, and stays facing that way when it stops; with something
  // to aim it faces its look, its hips turned toward the way its feet go.
  protected override walk(p: RemotePlayer, feetY: number, step: number): Pose {
    const walked = super.walk(p, feetY, step);
    const dt = this.watch(p, feetY);
    const { style, clips, out, other, third } = this;
    const pace = p.walk / walkSpeedOf(this.kind);
    const speed = Math.hypot(this.velX, this.velZ);
    const going = speed > MOVING;
    const armed = p.item !== null;
    const want = p.dead ? this.facing : armed ? p.yaw : going ? Math.atan2(this.velX, this.velZ) : this.facing;
    const turn = wrap(want - this.facing) * (1 - Math.exp((-3 * dt) / (armed ? EASE_AIM : EASE_TURN)));
    this.facing = wrap(this.facing + turn);
    this.root.rotation.y = this.facing;
    const banking = dt > 0 && !armed ? (turn / dt) * style.bank * Math.min(1, pace) : 0;
    this.bank = eased(this.bank, Math.max(-MAX_BANK, Math.min(MAX_BANK, banking)), dt, EASE_BANK);
    if (going) {
      const sin = Math.sin(this.facing);
      const cos = Math.cos(this.facing);
      this.dirX = eased(this.dirX, (this.velX * cos - this.velZ * sin) / speed, dt, EASE_DIRECTION);
      this.dirZ = eased(this.dirZ, (this.velX * sin + this.velZ * cos) / speed, dt, EASE_DIRECTION);
    }
    // Which way its feet go from the way it faces: ahead unless it's holding its look elsewhere.
    const aside = Math.atan2(this.dirX, this.dirZ);
    const backward = Math.abs(aside) > BACKPEDAL;
    const hips = Math.max(-SIDESTEP, Math.min(SIDESTEP, backward ? wrap(aside + Math.PI) : aside));

    // Standing, into its stride as it gets going: the walk or the run, or between them, at the
    // point in the stride the feet have got to (run backward, a stride is the same one reversed).
    this.moving = eased(this.moving, p.grounded && pace > 0.02 ? 1 : 0, dt, EASE_MOVING);
    const striding = this.moving > 0.999 ? 1 : this.moving < 0.001 ? 0 : smooth(this.moving);
    if (striding < 1) sample(out, clips.idle, this.stood / clips.idle.seconds, true);
    let grip = GRIP_IDLE;
    if (striding > 0) {
      const stride = striding < 1 ? other : out;
      const cycle = backward ? 1 - ((step / 2) % 1) : (step / 2) % 1;
      const running = smooth((pace - WALKS) / (RUNS - WALKS));
      if (running < 1) sample(stride, clips.walk, cycle, true);
      if (running > 0) sample(running < 1 ? third : stride, clips.run, cycle, true);
      if (running > 0 && running < 1) blend(stride, stride, third, running);
      if (striding < 1) blend(out, out, other, striding);
      grip += (GRIP_RUN - GRIP_IDLE) * striding * running;
    }

    // A landing, as hard as the drop from its highest point: into the crouch and back up out of it.
    if (p.grounded) {
      if (!this.grounded) {
        this.impact = Math.min(1, Math.sqrt(2 * GRAVITY * Math.max(0, this.peak - feetY)) / style.landSpeed);
        this.landing = 0;
      }
      this.peak = feetY;
    } else {
      if (this.grounded) this.falling = 0;
      this.peak = Math.max(this.peak, feetY);
      this.falling = Math.min(1, Math.max(0, this.falling + (this.sinking ? dt : -dt) / APEX_SECONDS));
    }
    this.grounded = p.grounded;
    this.landing += dt;
    if (this.landing < clips.land.seconds) {
      const through = this.landing / clips.land.seconds;
      sample(other, clips.land, through, false);
      blend(out, out, other, this.impact * Math.min(1, this.landing / LAND_IN) * (1 - smooth(through)));
    }

    // In the air: its jump going up and its fall coming down, by which way it last moved.
    this.aloft = p.grounded ? 0 : this.aloft + dt;
    this.kicking = eased(this.kicking, p.thrusting ? 0 : 1, dt, EASE_KICKING);
    this.airborne = Math.min(
      1,
      Math.max(0, this.airborne + (p.grounded ? -dt / TOUCHDOWN_SECONDS : dt / TAKEOFF_SECONDS)),
    );
    if (this.airborne > 0) {
      const down = smooth(this.falling);
      sample(other, clips.jump, this.aloft / clips.jump.seconds, false);
      sample(third, clips.fall, this.aloft / clips.fall.seconds, true);
      blend(other, other, third, down);
      if (style.flutter && this.kicking > 0.001) {
        sample(third, clips.run, this.aloft * style.flutter, true);
        blend(other, other, third, this.kicking, LEGS);
      }
      // A long jump is its own way through the air, takeoff to landing.
      this.leaping = Math.min(1, Math.max(0, this.leaping + (p.leap ? dt : -dt) / TAKEOFF_SECONDS));
      if (clips.leap && this.leaping > 0) {
        sample(third, clips.leap, this.aloft / clips.leap.seconds, false);
        blend(other, other, third, smooth(this.leaping));
      }
      const air = smooth(this.airborne);
      blend(out, out, other, air);
      grip += (GRIP_RUN + (GRIP_FALL - GRIP_RUN) * down - grip) * air;
    }

    const off = wrap(p.yaw - this.facing);
    const looks = smooth((HEAD_GIVES_UP - Math.abs(off)) / HEAD_FADE);
    const head = Math.max(-HEAD_TURN_LIMIT, Math.min(HEAD_TURN_LIMIT, off)) * looks;
    this.rig.play(out, grip, this.bank, armed ? hips * striding : 0, head, p.pitch * style.follow * looks);
    this.arm(p);
    return walked;
  }

  // On a ladder, where the walker has put the body: feet stepping the rungs, hands going up the rails.
  protected override climb(p: RemotePlayer, feetY: number, dt: number): Pose {
    const climbed = super.climb(p, feetY, dt);
    this.watch(p, feetY);
    this.moving = this.airborne = this.impact = 0;
    const held = this.rungs;
    const s = Math.sin(this.climbPhase);
    held.set(CLIMB);
    held[FOOT_L + FOOT_Y] += (RUNG / 2) * s;
    held[FOOT_R + FOOT_Y] -= (RUNG / 2) * s;
    held[ARM_L + ARM_SWING] += CLIMB_REACH * s;
    held[ARM_R + ARM_SWING] -= CLIMB_REACH * s;
    this.facing = WORLD_STRUCTURES.ladderFacing(p.climb!.piece, p.climb!.side);
    this.bank = 0;
    const off = wrap(p.yaw - this.facing);
    held[HEAD_TURN] = Math.max(-HEAD_TURN_LIMIT, Math.min(HEAD_TURN_LIMIT, off));
    held[HEAD_LEAN] += p.pitch * this.style.follow;
    this.rig.apply(held);
    this.arm(p);
    return climbed;
  }

  protected override lie(): void {
    super.lie();
    this.rig.apply(this.style.dead);
  }

  // With something in its hand, the weapon arm, straight, along the look.
  private arm(p: RemotePlayer): void {
    if (!p.item || p.dead) return;
    this.rig.straighten();
    this.aim(p);
  }

  // How the body has moved since it last did: its speed across the floor, and whether it went up
  // or down. A body isn't moved every frame (a player's own is moved a sim tick at a time, on
  // whichever frames the ticks fall, and between them only drifts a hair as its correction dies
  // away), so its speed across is taken over the time since it last moved by MOVED, which gives its
  // heading true and its size roughly, and nothing here is read from how fast it rises or falls,
  // only which. It's standing still only after STILL without moving. Returns the seconds since it
  // was last drawn.
  private watch(p: RemotePlayer, feetY: number): number {
    const now = performance.now() / 1000;
    const dt = this.drawn === null ? 0 : Math.min(0.1, now - this.drawn);
    this.drawn = now;
    this.stood += dt;
    const last = this.last;
    if (!last) {
      this.last = { x: p.x, y: feetY, z: p.z, at: now };
      this.facing = p.yaw;
      return dt;
    }
    const dx = p.x - last.x;
    const dy = feetY - last.y;
    const dz = p.z - last.z;
    const since = now - last.at;
    if (Math.hypot(dx, dy, dz) < MOVED && since < STILL) return dt;
    last.x = p.x;
    last.y = feetY;
    last.z = p.z;
    last.at = now;
    if (since <= 0 || Math.hypot(dx, dy, dz) > JUMPED) return dt;
    this.velX = dx / since;
    this.velZ = dz / since;
    if (Math.abs(dy) > MOVED) this.sinking = dy < 0;
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
  private readonly skin: SkinnedBody<JointedBone>;
  private readonly hipsAt: Vector3; // the hips' pivot, standing
  private readonly bones: TransformNode[]; // the bones a clip turns, in a clip's order
  private gripped = -1; // how closed `play` last left the hands, none yet
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

  constructor(engine: Engine, id: string, spec: JointedSpec, base: TransformNode) {
    const { kind, model } = spec;
    const skin = new SkinnedBody(engine, `${kind}-${id}`, model, kind, PARENTS, base);
    this.skin = skin;
    this.bones = CLIP_BONES.map((bone) => skin.node(bone));
    const at = (bone: JointedBone) => Vector3.FromArray(model.bones[bone] as number[]);
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
    // A held item is gripped in the right fist, the hand turned thumb up as a hand holds a pistol:
    // the palm's middle, with the fist's middle a little to the palm's side of it, turned with the
    // hand about the wrist. The grip hangs on the forearm, which stays as the model holds it while
    // the arm aims, so the walker turns the item along the look as it does for any arm.
    const armR = skin.node('armR');
    const palm = skin.offset('handR', model.hand);
    const grip = new TransformNode(`avatar-grip-${id}`, engine.scene);
    grip.parent = skin.node('forearmR');
    grip.position.copyFrom(skin.offset('forearmR', model.bones.handR));
    grip.position.addInPlaceFromFloats(palm.x, palm.z, palm.y + FIST);
    const chest = skin.node('chest');
    this.figure = {
      armR: { node: armR, grip, hold: HOLD, reach: at('handR').subtract(at('armR')).normalize() },
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

  // A clip's moment onto the bones as it has them, with what a clip can't know laid over it: the
  // lean into a turn (`bank`, radians to the right), the hips turned toward where the feet go and
  // the chest back by as much (`aside`), the head to the look, and how closed the hands are.
  play(m: Motion, grip: number, bank: number, aside: number, headTurn: number, headLean: number): void {
    const leg = this.thigh + this.shin;
    const [hips, spine, , head] = this.bones;
    hips.position.set(this.hipsAt.x + m[0] * leg, this.hipsAt.y + m[1] * leg, this.hipsAt.z + m[2] * leg);
    for (let b = 0; b < this.bones.length; b++) {
      const o = turnAt(b);
      (this.bones[b].rotationQuaternion ??= new Quaternion()).set(m[o], m[o + 1], m[o + 2], m[o + 3]);
    }
    // A turn before a bone's own is in its parent's frame: the hips' is the body's.
    if (bank !== 0 || aside !== 0) {
      turned(aside, 0, bank, A);
      A.multiplyToRef(hips.rotationQuaternion!, hips.rotationQuaternion!);
    }
    if (aside !== 0) {
      turned(-aside, 0, 0, A);
      A.multiplyToRef(spine.rotationQuaternion!, spine.rotationQuaternion!);
    }
    if (headTurn !== 0 || headLean !== 0) {
      turned(headTurn, headLean, 0, A);
      head.rotationQuaternion!.multiplyInPlace(A);
    }
    this.grip(grip);
  }

  // Both hands closed `grip` of the way to fists: turned only when that has changed.
  private grip(grip: number): void {
    if (Math.abs(grip - this.gripped) < 0.01) return;
    this.gripped = grip;
    this.hand(-1, grip, 'fingersL', 'thumbL');
    this.hand(1, grip, 'fingersR', 'thumbR');
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
    this.gripped = -1;
  }

  // The weapon arm from the shoulder down as the model holds it, straight, its hand closed on the
  // grip: what the walker aims.
  straighten(): void {
    set(this.skin.node('forearmR'), IDENTITY);
    set(this.skin.node('handR'), THUMB_UP);
    this.hand(1, 1, 'fingersR', 'thumbR');
    this.gripped = -1;
  }

  // An arm the model holds straight out to `side`: turned about its own length, then down to
  // hanging less how far it's held out, then swung ahead; the elbow bends the forearm the way a
  // hanging arm's faces, forward.
  private arm(
    pose: BodyPose,
    at: number,
    side: 1 | -1,
    upper: JointedBone,
    fore: JointedBone,
    hand: JointedBone,
    fingers: JointedBone,
    thumb: JointedBone,
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
  private hand(side: 1 | -1, grip: number, fingers: JointedBone, thumb: JointedBone): void {
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
    upper: JointedBone,
    lower: JointedBone,
    foot: JointedBone,
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

// Scratch for the frame's arithmetic, shared by every jointed body: none of it survives a call.
const IDENTITY = Quaternion.Identity();
// The right hand, which the model holds palm down, turned about the arm's length to thumb up.
const THUMB_UP = Quaternion.RotationAxis(Vector3.RightReadOnly, -Math.PI / 2);
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
