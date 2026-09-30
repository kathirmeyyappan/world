// Tung Tung Tung Sahur: a 3.2 m varnished wooden log (60% taller than everyone else) with a human
// face carved into its upper end, standing on long thin legs and trailing a bat from lanky arms.
// It is meant to be uncanny, so the face is sculpted rather than drawn: a heavy brow ridge,
// wide deep-set eyeballs under carved lids that roll to follow the viewer's camera, a long straight
// nose, high cheekbones, a closed-lip smile with smile lines, and a chin. It walks stiff-legged with
// dead arms, twitches its head now and then, and dies flat on its back, face up. Bot-only
// (AVATARS.sahur isn't wearable); the hit capsule, movement and items are everyone's, and a held item
// replaces the bat.
import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Texture,
  TransformNode,
  Vector3,
  type StandardMaterial,
} from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

// Metres, feet at 0. The log stands on the hips and runs to the top of the head; face heights are
// in the log's frame (above the hips).
const HEIGHT = 3.2;
const HIP = 1.4;
const RADIUS = 0.33; // side to side
const DEPTH = 0.9; // front-to-back radius as a fraction of RADIUS: a slightly flattened log
const EYE_Y = 1.44;
const EYE_X = 0.13;
const EYE_SIZE = 0.2;
const EYE_TURN = 0.7; // radians an eye can roll from straight ahead toward the viewer
const NOSE_TOP = 1.46;
const NOSE_TIP = 1.1;
const MOUTH_Y = 0.95;
const MOUTH_HALF = 0.19;
const SHOULDER_Y = 0.72;
const UPPER_ARM = 0.62;
const FOREARM = 0.6;
const THIGH = 0.71;
const SHIN = 0.69;
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id

// The log's front surface at x across it: a point on the face there sits at this z.
function faceZ(x: number): number {
  return RADIUS * DEPTH * Math.sqrt(Math.max(0, 1 - (x / RADIUS) ** 2));
}

interface Limb {
  top: TransformNode; // pivot at the shoulder or hip
  joint: TransformNode; // pivot at the elbow or knee
  end: TransformNode; // the hand or foot
}

export class SahurAvatar implements Avatar {
  readonly kind = 'sahur' as const;
  private readonly scene: Engine['scene'];
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly log: TransformNode; // everything above the hips, which sways and twitches
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly bat: Mesh;
  private readonly eyes: TransformNode[] = []; // a pivot at each eyeball's centre, iris and pupil on its front
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly twitchOffset: number;
  private readonly toLocal = new Matrix();
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
    this.scene = scene;
    this.twitchOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TWITCH_EVERY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;
    this.log = new TransformNode(`sahur-log-${id}`, scene);
    this.log.parent = this.body;
    this.log.position.y = HIP;

    const wood = varnished(flat(scene, `sahur-wood-${id}`, new Color3(1, 1, 1), 0.42));
    wood.diffuseTexture = grainTexture(scene, `sahur-grain-${id}`);
    const carved = wood; // the features are carved out of the log, so they share its wood
    const crease = flat(scene, `sahur-crease-${id}`, new Color3(0.36, 0.17, 0.07), 0.05);

    const white = varnished(flat(scene, `sahur-white-${id}`, new Color3(0.95, 0.93, 0.88), 0.45));
    const iris = flat(scene, `sahur-iris-${id}`, new Color3(0.2, 0.11, 0.05), 0.05);
    const black = flat(scene, `sahur-black-${id}`, new Color3(0.01, 0.01, 0.01), 0);
    const glint = flat(scene, `sahur-glint-${id}`, new Color3(1, 1, 1), 1);
    const batWood = varnished(flat(scene, `sahur-bat-${id}`, new Color3(0.9, 0.62, 0.34), 0.3));
    this.hitFlash = new HitFlash([wood, batWood]);

    const ball = (name: string, mat: StandardMaterial, size: Vector3, at: Vector3, parent: TransformNode) => {
      const m = MeshBuilder.CreateSphere(name, { diameter: 1, segments: 10 }, scene);
      m.material = mat;
      m.parent = parent;
      m.scaling.copyFrom(size);
      m.position.copyFrom(at);
      m.isPickable = false;
      return m;
    };
    const tube = (name: string, mat: StandardMaterial, path: Vector3[], radius: number) => {
      const m = MeshBuilder.CreateTube(name, { path, radius, tessellation: 6, cap: Mesh.CAP_ALL }, scene);
      m.material = mat;
      m.parent = this.log;
      m.isPickable = false;
      return m;
    };
    // A curve across the face, `lift(u)` above `y` at u = x / half, hugging the surface.
    const across = (half: number, y: number, lift: (u: number) => number, proud: number) =>
      Array.from({ length: 11 }, (_, i) => {
        const u = -1 + (2 * i) / 10;
        const x = u * half;
        return new Vector3(x, y + lift(u), faceZ(x) + proud);
      });

    logMesh(scene, `sahur-body-${id}`, this.log, wood);

    // Brow ridge: one heavy bar of wood across both eyes, standing proud of the face.
    ball(
      `sahur-brow-${id}`,
      carved,
      new Vector3(0.56, 0.1, 0.1),
      new Vector3(0, EYE_Y + 0.125, faceZ(0) - 0.03),
      this.log,
    );

    // Eyes: a dark socket, then a white eyeball whose front bulges out of it, a carved upper lid
    // over its top third and a bag under it. The iris, pupil and glint ride a pivot at the eyeball's
    // centre that rolls toward the viewer (update), so it stares at whoever looks, from any side.
    for (const side of [-1, 1]) {
      const x = side * EYE_X;
      const z = faceZ(x) - 0.035;
      ball(
        `sahur-socket-${side}-${id}`,
        crease,
        new Vector3(0.25, 0.19, 0.05),
        new Vector3(x, EYE_Y, faceZ(x) - 0.012),
        this.log,
      );
      ball(
        `sahur-eye-${side}-${id}`,
        white,
        new Vector3(EYE_SIZE, EYE_SIZE, EYE_SIZE),
        new Vector3(x, EYE_Y, z),
        this.log,
      );
      const lid = MeshBuilder.CreateSphere(
        `sahur-lid-${side}-${id}`,
        { diameter: EYE_SIZE + 0.02, segments: 10, slice: 0.36 },
        scene,
      );
      lid.material = carved;
      lid.parent = this.log;
      lid.position.set(x, EYE_Y, z);
      lid.rotation.x = -0.35; // tipped forward so it hoods the front of the eyeball
      lid.isPickable = false;
      ball(
        `sahur-bag-${side}-${id}`,
        carved,
        new Vector3(0.19, 0.045, 0.07),
        new Vector3(x, EYE_Y - 0.1, z + 0.06),
        this.log,
      );

      const pivot = new TransformNode(`sahur-eye-pivot-${side}-${id}`, scene);
      pivot.parent = this.log;
      pivot.position.set(x, EYE_Y, z);
      const r = EYE_SIZE / 2;
      disc(scene, `sahur-iris-${side}-${id}`, pivot, iris, 0.095).position.z = r - 0.003;
      disc(scene, `sahur-pupil-${side}-${id}`, pivot, black, 0.05).position.z = r + 0.001;
      disc(scene, `sahur-glint-${side}-${id}`, pivot, glint, 0.016).position.set(-0.015, 0.017, r + 0.003);
      this.eyes.push(pivot);
    }

    // Nose: a long straight ridge from between the brows to a rounded tip, with a wing either side.
    const ridge = MeshBuilder.CreateCylinder(
      `sahur-nose-${id}`,
      { diameterTop: 0.08, diameterBottom: 0.13, height: NOSE_TOP - NOSE_TIP, tessellation: 4 },
      scene,
    );
    ridge.material = carved;
    ridge.parent = this.log;
    ridge.rotation.set(-0.2, Math.PI / 4, 0); // an edge forward, the lower end further out
    ridge.position.set(0, (NOSE_TOP + NOSE_TIP) / 2, faceZ(0) + 0.045);
    ridge.isPickable = false;
    ball(
      `sahur-nose-tip-${id}`,
      carved,
      new Vector3(0.11, 0.09, 0.1),
      new Vector3(0, NOSE_TIP + 0.02, faceZ(0) + 0.09),
      this.log,
    );
    for (const side of [-1, 1])
      ball(
        `sahur-nostril-${side}-${id}`,
        carved,
        new Vector3(0.065, 0.055, 0.06),
        new Vector3(side * 0.06, NOSE_TIP + 0.005, faceZ(0.06) + 0.035),
        this.log,
      );

    // Cheekbones: long low ridges sloping out and down from under the eyes.
    for (const side of [-1, 1]) {
      const x = side * 0.19;
      const cheek = ball(
        `sahur-cheek-${side}-${id}`,
        carved,
        new Vector3(0.2, 0.07, 0.06),
        new Vector3(x, EYE_Y - 0.2, faceZ(x) - 0.012),
        this.log,
      );
      cheek.rotation.set(0, side * 0.5, -side * 0.4);
    }

    // Mouth: closed lips in a wide smile, corners turned up (the left a touch higher), a dark line
    // between them, smile lines from the nose wings down past the corners, and a small chin.
    const smile = (u: number) => 0.05 * u * u + (u < 0 ? -0.014 * u : 0);
    tube(`sahur-lip-top-${id}`, carved, across(MOUTH_HALF, MOUTH_Y + 0.016, smile, 0.006), 0.013);
    tube(
      `sahur-lip-bottom-${id}`,
      carved,
      across(MOUTH_HALF * 0.8, MOUTH_Y - 0.02, (u) => smile(u) * 0.7, 0.006),
      0.017,
    );
    tube(`sahur-mouth-${id}`, crease, across(MOUTH_HALF * 1.02, MOUTH_Y, smile, 0.016), 0.006);
    for (const side of [-1, 1]) {
      const fold = [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const x = side * (0.08 + 0.15 * t);
        return new Vector3(x, NOSE_TIP - 0.01 - 0.2 * t + 0.06 * t * t, faceZ(x) + 0.004);
      });
      tube(`sahur-fold-${side}-${id}`, crease, fold, 0.005);
    }
    ball(
      `sahur-chin-${id}`,
      carved,
      new Vector3(0.18, 0.1, 0.05),
      new Vector3(0, MOUTH_Y - 0.12, faceZ(0) - 0.012),
      this.log,
    );

    // Limbs: thin wooden rods jointed at the elbow or knee, pivoting at the top.
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
      rod(scene, `${name}-upper`, top, carved, upper, radius);
      const joint = new TransformNode(`${name}-joint`, scene);
      joint.parent = top;
      joint.position.y = -upper;
      ball(`${name}-joint-knob`, carved, new Vector3(radius * 2.4, radius * 2.4, radius * 2.4), Vector3.Zero(), joint);
      rod(scene, `${name}-lower`, joint, carved, lower, radius * 0.9);
      const end = new TransformNode(`${name}-end`, scene);
      end.parent = joint;
      end.position.y = -lower;
      return { top, joint, end };
    };
    this.legL = limb(`sahur-legL-${id}`, this.body, new Vector3(-0.13, HIP + 0.05, 0), THIGH, SHIN, 0.045);
    this.legR = limb(`sahur-legR-${id}`, this.body, new Vector3(0.13, HIP + 0.05, 0), THIGH, SHIN, 0.045);
    for (const leg of [this.legL, this.legR])
      ball(`${leg.top.name}-foot`, carved, new Vector3(0.11, 0.05, 0.22), new Vector3(0, -0.025, 0.06), leg.end);
    this.armL = limb(
      `sahur-armL-${id}`,
      this.log,
      new Vector3(-(RADIUS + 0.03), SHOULDER_Y, 0),
      UPPER_ARM,
      FOREARM,
      0.04,
    );
    this.armR = limb(`sahur-armR-${id}`, this.log, new Vector3(RADIUS + 0.03, SHOULDER_Y, 0), UPPER_ARM, FOREARM, 0.04);
    for (const [side, arm] of [
      [-1, this.armL],
      [1, this.armR],
    ] as const) {
      arm.top.rotation.z = side * 0.1; // hanging just clear of the log
      arm.joint.rotation.x = -0.12; // elbows soft, forearms a little forward
      ball(`${arm.top.name}-hand`, carved, new Vector3(0.08, 0.1, 0.07), new Vector3(0, -0.04, 0), arm.end);
    }

    // The bat: a tapered club gripped at the handle, its end resting on the ground ahead.
    this.bat = MeshBuilder.CreateCylinder(
      `sahur-bat-${id}`,
      { diameterTop: 0.045, diameterBottom: 0.12, height: 1.15, tessellation: 12 },
      scene,
    );
    this.bat.material = batWood;
    this.bat.parent = this.armR.end;
    this.bat.setPivotPoint(new Vector3(0, 0.55, 0)); // the grip, near the handle's end
    this.bat.position.set(0, -0.55, 0);
    this.bat.rotation.x = -0.5; // the barrel out in front
    this.bat.isPickable = false;

    // A held item goes in the right hand instead of the bat; the flamethrower's tank rides on the back.
    this.items = new HeldItems(
      engine,
      `sahur-${id}`,
      this.armR.end,
      new Vector3(0, -0.05, 0.04),
      this.log,
      new Vector3(0, SHOULDER_Y + 0.1, -(RADIUS * DEPTH + 0.1)),
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
    // the log bobs; the arms barely move.
    if (moved > 0.002 && !airborne) this.phase += moved * 3.2;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const swing = airborne ? 0.2 : Math.sin(this.phase) * 0.38 * effort;
    this.legL.top.rotation.x = swing;
    this.legR.top.rotation.x = -swing;
    this.legL.joint.rotation.x = Math.max(0, -swing) * 0.9;
    this.legR.joint.rotation.x = Math.max(0, swing) * 0.9;
    this.log.position.y = HIP + (airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.06 * effort);

    // The log leans a little with the look and sways slowly; every few seconds, a short jerk sideways.
    const now = performance.now();
    const sinceTwitch = (now + this.twitchOffset) % TWITCH_EVERY_MS;
    const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
    this.log.rotation.set(p.pitch * 0.12, 0, Math.sin(now / 1700 + this.twitchOffset) * 0.03 + twitch);

    const dangle = Math.sin(this.phase) * 0.05 * effort;
    this.armL.top.rotation.x = dangle;
    this.armR.top.rotation.x = p.item ? -Math.PI / 2 + p.pitch : -dangle;
    this.armR.joint.rotation.x = p.item ? 0 : -0.12;
    this.bat.setEnabled(!p.item);
    this.items.update(p.item, p.firing);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen flat on its back like a felled log, face to the sky, lifted by its depth to lie on
      // the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? RADIUS * DEPTH : 0;
    }
    if (p.dead) {
      for (const leg of [this.legL, this.legR]) leg.top.rotation.x = leg.joint.rotation.x = 0;
      this.log.rotation.set(0, 0, 0);
      this.log.position.y = HIP;
    }
    this.followViewer();
    placeShadow(this.shadow, p, feetY);
    this.root.setEnabled(true);
  }

  // Rolls each eye toward the camera, in the log's own frame, as far as EYE_TURN: the eyes find you
  // from any angle in front, and from behind they stare as far round as they go.
  private followViewer(): void {
    const camera = this.scene.activeCamera;
    if (!camera) return;
    this.log.computeWorldMatrix(true).invertToRef(this.toLocal);
    const viewer = Vector3.TransformCoordinates(camera.globalPosition, this.toLocal);
    const clamp = (a: number) => Math.max(-EYE_TURN, Math.min(EYE_TURN, a));
    for (const eye of this.eyes) {
      const d = viewer.subtract(eye.position);
      eye.rotation.set(clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z))), clamp(Math.atan2(d.x, d.z)), 0);
    }
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

// Polished wood: a soft highlight, so the carving reads by its shine as well as its shading.
function varnished(m: StandardMaterial): StandardMaterial {
  m.specularColor = new Color3(0.22, 0.16, 0.1);
  m.specularPower = 24;
  return m;
}

// The log from the hips up: slightly narrower at the bottom, straight sides and a rounded top,
// smooth-shaded and flattened front to back.
function logMesh(scene: Engine['scene'], name: string, parent: TransformNode, mat: StandardMaterial): Mesh {
  const top = HEIGHT - HIP;
  const shape = [new Vector3(0, 0, 0), new Vector3(RADIUS * 0.9, 0, 0), new Vector3(RADIUS, 0.2, 0)];
  const dome = 0.22;
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    shape.push(new Vector3(RADIUS * Math.cos(a), top - dome + dome * Math.sin(a), 0));
  }
  const m = MeshBuilder.CreateLathe(name, { shape, tessellation: 24, sideOrientation: Mesh.DOUBLESIDE }, scene);
  m.scaling.z = DEPTH;
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// A limb's rod: a thin cylinder hanging down from its pivot.
function rod(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  length: number,
  radius: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(name, { diameter: radius * 2, height: length, tessellation: 8 }, scene);
  m.material = mat;
  m.parent = parent;
  m.position.y = -length / 2;
  m.isPickable = false;
  return m;
}

// Wood: warm tan with faint grain running up the log, low in contrast so it reads as polished.
function grainTexture(scene: Engine['scene'], name: string): DynamicTexture {
  const size = 32;
  const tex = new DynamicTexture(name, size, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#e09a52';
  ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = 0; x < size; x++) {
    if (rng() < 0.3) {
      ctx.fillStyle = rng() < 0.5 ? '#d48e4a' : '#d9934d';
      for (let y = 0; y < size; y++) if (rng() < 0.85) ctx.fillRect(x, y, 1, 1);
    }
  }
  tex.update();
  return tex;
}

// A thin disc facing +z, for the irises, pupils and glints.
function disc(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  diameter: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(name, { diameter, height: 0.006, tessellation: 12 }, scene);
  m.rotation.x = Math.PI / 2;
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}
