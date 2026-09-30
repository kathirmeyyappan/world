// Tung Tung Tung Sahur: a 3.2 m smooth wooden log (60% taller than everyone else), yellow at its
// flat-topped head fading to orange below, with a face that swells out of it: round cheeks that bulge
// past the log's sides, a long nose ending in a bulb, a raised muzzle with a wide toothy smile, and
// eyeballs that are nearly all pupil, set in dark sockets under a separate indented arc each and
// staring fixed, a little wall-eyed, at nothing. Short bent arms hold a bat forward; thin legs end
// in big bare feet. It walks stiff-legged, twitches its head now and then, and dies flat on its back.
// Bot-only (AVATARS.sahur isn't wearable); the hit capsule, movement and items are everyone's, and a
// held item replaces the bat.
import {
  Color3,
  Mesh,
  MeshBuilder,
  TransformNode,
  Vector3,
  VertexBuffer,
  type StandardMaterial,
} from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

// Metres, feet at 0. The log stands on the hips and runs to the flat top of the head; face heights
// are in the log's frame (above the hips).
const HEIGHT = 3.2;
const HIP = 1.35;
const LOG = HEIGHT - HIP;
const RADIUS = 0.3;
const EYE_Y = 1.5;
const EYE_X = 0.1;
const EYE_SIZE = 0.16;
const PUPIL = 0.72; // pupil diameter as a fraction of the eyeball's: a thin ring of white
const STARE_OUT = 0.09; // radians each eye turns outward: the gaze never quite meets yours
const NOSE_TIP = EYE_Y - 0.21;
const MOUTH_Y = EYE_Y - 0.33;
const SHOULDER_Y = 0.95;
const UPPER_ARM = 0.42;
const FOREARM = 0.4;
const THIGH = 0.7;
const SHIN = 0.62;
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id

// Skin colour up the log: orange at the hips, yellow at the top of the head (t from 0 to 1).
const SKIN_LOW = new Color3(0.9, 0.5, 0.16);
const SKIN_MID = new Color3(0.95, 0.64, 0.2);
const SKIN_TOP = new Color3(1, 0.8, 0.24);
const LIMB = new Color3(0.9, 0.5, 0.18);

// The log's front surface at x across it: a point on the face there sits at this z.
function faceZ(x: number): number {
  return Math.sqrt(Math.max(0, RADIUS * RADIUS - x * x));
}

// The muzzle: an ellipsoid swelling forward round the mouth, and its front surface at (x, y).
const MUZZLE = { x: 0, y: MOUTH_Y + 0.02, z: faceZ(0) - 0.07, rx: 0.21, ry: 0.13, rz: 0.12 };
function muzzleZ(x: number, y: number): number {
  const k = 1 - (x / MUZZLE.rx) ** 2 - ((y - MUZZLE.y) / MUZZLE.ry) ** 2;
  return MUZZLE.z + MUZZLE.rz * Math.sqrt(Math.max(0, k));
}

interface Limb {
  top: TransformNode; // pivot at the shoulder or hip
  joint: TransformNode; // pivot at the elbow or knee
  end: TransformNode; // the hand or foot
}

export class SahurAvatar implements Avatar {
  readonly kind = 'sahur' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly log: TransformNode; // everything above the hips, which sways and twitches
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly bat: TransformNode;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly twitchOffset: number;
  private dead = false;
  private phase = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(
    engine: Engine,
    readonly id: string,
    name: string,
    color: string,
  ) {
    const scene = engine.scene;
    this.twitchOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TWITCH_EVERY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;
    this.log = new TransformNode(`sahur-log-${id}`, scene);
    this.log.parent = this.body;
    this.log.position.y = HIP;

    // Coloured per vertex (paintSkin); the glow is the middle of that range, so the tint holds.
    const skin = glossy(flat(scene, `sahur-skin-${id}`, Color3.White(), 0));
    skin.emissiveColor = SKIN_MID.scale(0.45);
    const limbMat = glossy(flat(scene, `sahur-limb-${id}`, LIMB, 0.45));
    const crease = flat(scene, `sahur-crease-${id}`, new Color3(0.62, 0.3, 0.1), 0.2);
    const white = glossy(flat(scene, `sahur-white-${id}`, new Color3(0.97, 0.96, 0.93), 0.5));
    const black = flat(scene, `sahur-black-${id}`, new Color3(0.01, 0.01, 0.01), 0);
    const teeth = flat(scene, `sahur-teeth-${id}`, new Color3(0.95, 0.9, 0.78), 0.4);
    const batMat = glossy(flat(scene, `sahur-bat-${id}`, new Color3(0.62, 0.3, 0.12), 0.25));
    const batEnd = flat(scene, `sahur-bat-end-${id}`, new Color3(0.42, 0.18, 0.07), 0.15);
    this.hitFlash = new HitFlash([skin, limbMat, batMat]);

    // The head is modelled in the log's frame on a scratch node, then merged into one mesh per
    // material and hung on the log: a handful of draw calls for the whole face.
    const head = new TransformNode(`sahur-head-${id}`, scene);
    const parts = new Map<StandardMaterial, Mesh[]>();
    const add = (m: Mesh, mat: StandardMaterial) => {
      m.parent = m.parent ?? head;
      parts.set(mat, [...(parts.get(mat) ?? []), m]);
      return m;
    };
    const ball = (mat: StandardMaterial, at: Vector3, radii: Vector3, segments = 12) => {
      const m = MeshBuilder.CreateSphere(`sahur-part-${id}`, { diameter: 2, segments }, scene);
      m.position.copyFrom(at);
      m.scaling.copyFrom(radii);
      return add(m, mat);
    };
    const tube = (mat: StandardMaterial, path: Vector3[], radius: number) =>
      add(MeshBuilder.CreateTube(`sahur-part-${id}`, { path, radius, tessellation: 6, cap: Mesh.CAP_ALL }, scene), mat);

    add(logMesh(scene, `sahur-body-${id}`), skin);

    // Cheeks: round volumes swelling out under the eyes, past the log's own sides.
    for (const side of [-1, 1]) {
      const x = side * 0.18;
      ball(skin, new Vector3(x, EYE_Y - 0.17, faceZ(x) - 0.06), new Vector3(0.15, 0.12, 0.1));
    }
    // The muzzle, and a small chin under it.
    ball(skin, new Vector3(MUZZLE.x, MUZZLE.y, MUZZLE.z), new Vector3(MUZZLE.rx, MUZZLE.ry, MUZZLE.rz));
    ball(skin, new Vector3(0, MOUTH_Y - 0.12, faceZ(0) - 0.03), new Vector3(0.09, 0.06, 0.06));

    // Nose: a narrow bridge from between the eyes down to a bulbous tip, with a wing either side.
    const bridge = MeshBuilder.CreateCylinder(
      `sahur-part-${id}`,
      { diameterTop: 0.05, diameterBottom: 0.07, height: EYE_Y - NOSE_TIP, tessellation: 10 },
      scene,
    );
    bridge.position.set(0, (EYE_Y + NOSE_TIP) / 2 - 0.01, faceZ(0) + 0.02);
    bridge.rotation.x = -0.18; // the lower end further out
    add(bridge, skin);
    ball(skin, new Vector3(0, NOSE_TIP, faceZ(0) + 0.055), new Vector3(0.055, 0.048, 0.05));
    for (const side of [-1, 1])
      ball(skin, new Vector3(side * 0.04, NOSE_TIP - 0.01, faceZ(0) + 0.03), new Vector3(0.03, 0.028, 0.03));

    // Eyes: a dark socket each, an eyeball bulging out of it that is nearly all pupil, fixed and
    // turned a little outward, and a separate indented arc over each, with the skin swelling above it.
    for (const side of [-1, 1]) {
      const x = side * EYE_X;
      const z = faceZ(x) - 0.03;
      ball(crease, new Vector3(x, EYE_Y, faceZ(x) - 0.03), new Vector3(0.1, 0.095, 0.06));
      ball(white, new Vector3(x, EYE_Y, z), new Vector3(EYE_SIZE / 2, EYE_SIZE / 2, EYE_SIZE / 2), 16);
      const gaze = new TransformNode(`sahur-gaze-${side}-${id}`, scene);
      gaze.parent = head;
      gaze.position.set(x, EYE_Y, z);
      gaze.rotation.set(0.04, side * STARE_OUT, 0);
      const pupil = MeshBuilder.CreateSphere(`sahur-part-${id}`, { diameter: 2, segments: 12 }, scene);
      pupil.parent = gaze;
      pupil.position.z = EYE_SIZE / 2 - 0.012;
      pupil.scaling.set((EYE_SIZE * PUPIL) / 2, (EYE_SIZE * PUPIL) / 2, 0.02);
      add(pupil, black);
      const arc = Array.from({ length: 9 }, (_, i) => {
        const a = Math.PI * (0.18 + 0.64 * (i / 8));
        const ax = x + Math.cos(a) * 0.098;
        return new Vector3(ax, EYE_Y + 0.005 + Math.sin(a) * 0.092, faceZ(ax) + 0.002);
      });
      tube(crease, arc, 0.007);
      ball(skin, new Vector3(x, EYE_Y + 0.135, faceZ(x) - 0.02), new Vector3(0.1, 0.035, 0.035));
    }

    // Mouth: a wide smile across the muzzle, corners up into the cheeks, a strip of teeth showing in
    // the middle.
    const smile = (u: number) => 0.055 * u * u;
    const line = (half: number, y: number, lift: (u: number) => number, proud: number) =>
      Array.from({ length: 13 }, (_, i) => {
        const u = -1 + (2 * i) / 12;
        const x = u * half;
        const yy = y + lift(u);
        return new Vector3(x, yy, muzzleZ(x, yy) + proud);
      });
    tube(crease, line(0.17, MOUTH_Y, smile, 0.004), 0.011);
    tube(
      teeth,
      line(0.09, MOUTH_Y + 0.017, (u) => smile(u) * 0.6, -0.002),
      0.013,
    );

    for (const [mat, meshes] of parts) {
      const merged = Mesh.MergeMeshes(meshes, true, true)!;
      merged.name = `sahur-${mat.name}`;
      merged.material = mat;
      merged.parent = this.log;
      merged.isPickable = false;
      if (mat === skin) paintSkin(merged);
    }
    head.dispose();

    // Limbs: tapered rods jointed at the elbow or knee, pivoting at the top.
    const limb = (
      name: string,
      parent: TransformNode,
      at: Vector3,
      upper: number,
      lower: number,
      radius: number,
    ): Limb => {
      const top = new TransformNode(`${name}-top`, scene);
      top.parent = parent;
      top.position.copyFrom(at);
      rod(scene, `${name}-upper`, top, limbMat, upper, radius, radius * 0.85);
      const joint = new TransformNode(`${name}-joint`, scene);
      joint.parent = top;
      joint.position.y = -upper;
      knob(scene, `${name}-knob`, joint, limbMat, radius * 0.95);
      rod(scene, `${name}-lower`, joint, limbMat, lower, radius * 0.85, radius * 0.7);
      const end = new TransformNode(`${name}-end`, scene);
      end.parent = joint;
      end.position.y = -lower;
      return { top, joint, end };
    };
    this.legL = limb(`sahur-legL-${id}`, this.body, new Vector3(-0.13, HIP + 0.04, 0), THIGH, SHIN, 0.055);
    this.legR = limb(`sahur-legR-${id}`, this.body, new Vector3(0.13, HIP + 0.04, 0), THIGH, SHIN, 0.055);
    for (const [side, leg] of [
      [-1, this.legL],
      [1, this.legR],
    ] as const)
      barefoot(scene, `${leg.top.name}-foot`, leg.end, limbMat, side);

    this.armL = limb(
      `sahur-armL-${id}`,
      this.log,
      new Vector3(-(RADIUS + 0.02), SHOULDER_Y, 0),
      UPPER_ARM,
      FOREARM,
      0.045,
    );
    this.armR = limb(
      `sahur-armR-${id}`,
      this.log,
      new Vector3(RADIUS + 0.02, SHOULDER_Y, 0),
      UPPER_ARM,
      FOREARM,
      0.045,
    );
    for (const [side, arm] of [
      [-1, this.armL],
      [1, this.armR],
    ] as const) {
      arm.top.rotation.z = side * 0.18; // upper arms out from the log a little
      knob(scene, `${arm.top.name}-fist`, arm.end, limbMat, 0.05);
    }

    // The bat: gripped in the right fist, barrel forward and down, its end darker.
    this.bat = new TransformNode(`sahur-bat-${id}`, scene);
    this.bat.parent = this.armR.end;
    this.bat.rotation.set(-0.35, 0, -0.45); // with the bent forearm, the barrel points forward, down and across the body
    const club = MeshBuilder.CreateCylinder(
      `sahur-bat-club-${id}`,
      { diameterTop: 0.05, diameterBottom: 0.13, height: 0.85, tessellation: 14 },
      scene,
    );
    club.material = batMat;
    club.parent = this.bat;
    club.position.y = -0.36;
    club.isPickable = false;
    const cap = MeshBuilder.CreateCylinder(
      `sahur-bat-cap-${id}`,
      { diameter: 0.13, height: 0.01, tessellation: 14 },
      scene,
    );
    cap.material = batEnd;
    cap.parent = club;
    cap.position.y = -0.43;
    cap.isPickable = false;

    // A held item goes in the right fist instead of the bat; the flamethrower's tank rides on the back.
    this.items = new HeldItems(
      engine,
      `sahur-${id}`,
      this.armR.end,
      new Vector3(0, -0.03, 0.04),
      this.log,
      new Vector3(0, SHOULDER_Y + 0.1, -(RADIUS + 0.1)),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.2);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;

    const tag = createTag(engine, id, name, color);
    tag.parent = this.root;
    tag.position.y = HEIGHT + 0.4;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;

    // Stilted walk: stiff thighs swing from the hip, a knee bends only as its leg swings back, and
    // the log bobs; the arms keep their pose.
    if (moved > 0.002 && !airborne) this.phase += moved * 3.4;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const swing = airborne ? 0.2 : Math.sin(this.phase) * 0.36 * effort;
    this.legL.top.rotation.x = swing;
    this.legR.top.rotation.x = -swing;
    this.legL.joint.rotation.x = 0.05 + Math.max(0, -swing) * 0.9;
    this.legR.joint.rotation.x = 0.05 + Math.max(0, swing) * 0.9;
    this.log.position.y = HIP + (airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.05 * effort);

    // The log leans a little with the look and sways slowly; every few seconds, a short jerk sideways.
    const now = performance.now();
    const sinceTwitch = (now + this.twitchOffset) % TWITCH_EVERY_MS;
    const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
    this.log.rotation.set(p.pitch * 0.12, 0, Math.sin(now / 1700 + this.twitchOffset) * 0.03 + twitch);

    // Arms: upper arms hang, forearms bent forward, fists at the front of the hips.
    this.armL.top.rotation.x = 0.1;
    this.armL.joint.rotation.x = -1.0;
    this.armR.top.rotation.x = p.item ? -Math.PI / 2 + p.pitch : 0.05;
    this.armR.joint.rotation.x = p.item ? 0 : -1.15;
    this.bat.setEnabled(!p.item);
    this.items.update(p.item, p.firing);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen flat on its back like a felled log, face to the sky, lifted by its radius to lie on
      // the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? RADIUS : 0;
    }
    if (p.dead) {
      for (const leg of [this.legL, this.legR]) leg.top.rotation.x = leg.joint.rotation.x = 0;
      this.log.rotation.set(0, 0, 0);
      this.log.position.y = HIP;
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
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.body) : null;
  }
}

// Smooth and a little shiny, like the render the character comes from.
function glossy(m: StandardMaterial): StandardMaterial {
  m.specularColor = new Color3(0.25, 0.2, 0.12);
  m.specularPower = 20;
  return m;
}

// The log from the hips up: straight sides and a flat top with a rounded rim, in the log's frame.
function logMesh(scene: Engine['scene'], name: string): Mesh {
  const shape = [new Vector3(0, 0, 0), new Vector3(RADIUS * 0.94, 0, 0), new Vector3(RADIUS, 0.08, 0)];
  const rim = 0.07;
  for (let i = 0; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    shape.push(new Vector3(RADIUS - rim + rim * Math.cos(a), LOG - rim + rim * Math.sin(a), 0));
  }
  shape.push(new Vector3(0, LOG, 0));
  return MeshBuilder.CreateLathe(name, { shape, tessellation: 28, sideOrientation: Mesh.DOUBLESIDE }, scene);
}

// Colours a merged skin mesh by height: orange at the hips to yellow at the top of the head.
function paintSkin(m: Mesh): void {
  const positions = m.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = Math.max(0, Math.min(1, positions[i + 1] / LOG));
    const c = t < 0.55 ? Color3.Lerp(SKIN_LOW, SKIN_MID, t / 0.55) : Color3.Lerp(SKIN_MID, SKIN_TOP, (t - 0.55) / 0.45);
    colors.push(c.r, c.g, c.b, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, colors);
}

// A limb segment: a tapered cylinder hanging down from its pivot.
function rod(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  length: number,
  top: number,
  bottom: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(
    name,
    { diameterTop: top * 2, diameterBottom: bottom * 2, height: length, tessellation: 10 },
    scene,
  );
  m.material = mat;
  m.parent = parent;
  m.position.y = -length / 2;
  m.isPickable = false;
  return m;
}

// A round joint, fist or knob at a pivot.
function knob(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  radius: number,
): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 8 }, scene);
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// A big bare foot: a long flattened sole turned a little outward, with five toes across its front.
function barefoot(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  side: number,
): void {
  const foot = new TransformNode(name, scene);
  foot.parent = parent;
  foot.rotation.y = side * 0.3;
  const sole = MeshBuilder.CreateSphere(`${name}-sole`, { diameter: 2, segments: 10 }, scene);
  sole.material = mat;
  sole.parent = foot;
  sole.scaling.set(0.075, 0.045, 0.15);
  sole.position.set(0, 0.035, 0.07);
  sole.isPickable = false;
  for (let i = 0; i < 5; i++) {
    const toe = MeshBuilder.CreateSphere(`${name}-toe-${i}`, { diameter: 2, segments: 6 }, scene);
    toe.material = mat;
    toe.parent = foot;
    const big = i === (side < 0 ? 4 : 0) ? 1.35 : 1; // the big toe on the inside
    toe.scaling.set(0.022 * big, 0.02 * big, 0.026 * big);
    toe.position.set((i - 2) * 0.03, 0.02, 0.215 - Math.abs(i - 2) * 0.012);
    toe.isPickable = false;
  }
}
