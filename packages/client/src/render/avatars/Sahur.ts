// Tung Tung Tung Sahur: a 3.2 m wooden log (60% taller than everyone else) on long stick legs,
// with a bat in its right hand. It is meant to be uncanny: bulging eyes whose pupils follow the
// viewer's camera wherever it is, brows raised in a fixed stare, a grin too wide and a little
// lopsided, arms that hang dead while it walks stiff-legged, and now and then a small twitch of the
// head. It dies flat on its back, still staring up. Bot-only (AVATARS.sahur isn't wearable); the
// hit capsule, movement and items are everyone's, and a held item replaces the bat.
import { Color3, DynamicTexture, Matrix, Mesh, MeshBuilder, Texture, TransformNode, Vector3 } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { box, centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

// Metres, feet at 0. The log stands on the hips and runs to the top of the head.
const HEIGHT = 3.2;
const HIP = 1.25;
const RADIUS = 0.3;
const EYE_Y = 2.78;
const EYE_X = 0.115;
const EYE_SIZE = 0.2;
const EYE_TURN = 0.75; // radians an eye can roll from straight ahead toward the viewer
const MOUTH_Y = 2.36;
const SHOULDER_Y = 2.05;
const ARM_LENGTH = 1.0;
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id

export class SahurAvatar implements Avatar {
  readonly kind = 'sahur' as const;
  private readonly scene: Engine['scene'];
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly log: TransformNode; // everything above the hips, which sways and twitches
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
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

    const wood = flat(scene, `sahur-wood-${id}`, new Color3(1, 1, 1), 0.35);
    wood.diffuseTexture = grainTexture(scene, `sahur-grain-${id}`);
    const stick = flat(scene, `sahur-stick-${id}`, new Color3(0.58, 0.36, 0.17), 0.2);
    const pale = flat(scene, `sahur-pale-${id}`, new Color3(0.86, 0.62, 0.36), 0.3);
    const dark = flat(scene, `sahur-dark-${id}`, new Color3(0.2, 0.1, 0.05), 0);
    const white = flat(scene, `sahur-white-${id}`, new Color3(0.95, 0.93, 0.86), 0.5);
    const black = flat(scene, `sahur-black-${id}`, new Color3(0.02, 0.02, 0.02), 0);
    const iris = flat(scene, `sahur-iris-${id}`, new Color3(0.26, 0.15, 0.08), 0.05);
    this.hitFlash = new HitFlash([wood, stick, pale]);

    logMesh(scene, `sahur-body-${id}`, this.log, wood);
    const faceZ = (x: number) => Math.sqrt(RADIUS * RADIUS - x * x); // the log's front surface at x

    // Eyes: bulging white balls half sunk into the wood, each with a brown iris and a black pupil on a
    // pivot at the ball's centre. Every frame (update) the pivots roll toward the viewer, so it stares
    // at whoever is looking, from any side.
    for (const side of [-1, 1]) {
      const x = side * EYE_X;
      const ball = MeshBuilder.CreateSphere(`sahur-eye-${side}-${id}`, { diameter: EYE_SIZE, segments: 6 }, scene);
      ball.convertToFlatShadedMesh();
      ball.material = white;
      ball.parent = this.log;
      ball.position.set(x, EYE_Y - HIP, faceZ(x) - 0.02);
      ball.isPickable = false;
      const pivot = new TransformNode(`sahur-eye-pivot-${side}-${id}`, scene);
      pivot.parent = this.log;
      pivot.position.copyFrom(ball.position);
      disc(scene, `sahur-iris-${side}-${id}`, pivot, iris, 0.085).position.z = EYE_SIZE / 2 - 0.004;
      disc(scene, `sahur-pupil-${side}-${id}`, pivot, black, 0.045).position.z = EYE_SIZE / 2 + 0.002;
      this.eyes.push(pivot);
      // Brows: thin, high and arched outward, a surprised look that never relaxes.
      const brow = box(scene, `sahur-brow-${side}-${id}`, 0.15, 0.025, 0.03, dark, this.log);
      brow.position.set(x + side * 0.02, EYE_Y - HIP + 0.19, faceZ(x) + 0.005);
      brow.rotation.z = -side * 0.28;
    }

    // Nose: a long ridge down the middle of the face.
    const nose = box(scene, `sahur-nose-${id}`, 0.07, 0.3, 0.1, pale, this.log);
    nose.position.set(0, (EYE_Y + MOUTH_Y) / 2 - HIP + 0.02, RADIUS + 0.03);

    // Mouth: a thin dark grin from cheek to cheek, corners curling up, the left one higher. Short
    // dark creases bracket the corners.
    const SEGMENTS = 9;
    const HALF = 0.21;
    for (let i = 0; i < SEGMENTS; i++) {
      const x = -HALF + ((i + 0.5) / SEGMENTS) * 2 * HALF;
      const u = x / HALF;
      const y = MOUTH_Y - HIP + 0.075 * u * u + (u < 0 ? 0.018 * -u : 0);
      const seg = box(scene, `sahur-mouth-${i}-${id}`, (2 * HALF) / SEGMENTS + 0.012, 0.028, 0.03, dark, this.log);
      seg.position.set(x, y, faceZ(x) + 0.004);
      seg.rotation.y = Math.asin(x / RADIUS);
      seg.rotation.z = Math.atan(0.15 * u) * 0.9;
    }
    for (const side of [-1, 1]) {
      const crease = box(scene, `sahur-crease-${side}-${id}`, 0.018, 0.1, 0.03, dark, this.log);
      const x = side * (HALF + 0.03);
      crease.position.set(x, MOUTH_Y - HIP + 0.07, faceZ(x) + 0.002);
      crease.rotation.set(0, Math.asin(x / RADIUS), side * 0.35);
    }

    // Legs: thin sticks from the hips, pivoting there, each on a small flat foot.
    const leg = (side: number) => {
      const m = box(scene, `sahur-leg-${side}-${id}`, 0.075, HIP, 0.075, stick, this.body);
      m.position.set(side * 0.13, HIP / 2, 0);
      m.setPivotPoint(new Vector3(0, HIP / 2, 0));
      const foot = box(scene, `sahur-foot-${side}-${id}`, 0.1, 0.04, 0.2, stick, m);
      foot.position.set(0, -HIP / 2 + 0.02, 0.05);
      return m;
    };
    this.legL = leg(-1);
    this.legR = leg(1);

    // Arms: sticks hanging from the shoulders, splayed a little, with a knob of a hand.
    const arm = (side: number) => {
      const m = box(scene, `sahur-arm-${side}-${id}`, 0.06, ARM_LENGTH, 0.06, stick, this.log);
      m.position.set(side * (RADIUS + 0.04), SHOULDER_Y - HIP - ARM_LENGTH / 2, 0.02);
      m.setPivotPoint(new Vector3(0, ARM_LENGTH / 2, 0));
      m.rotation.z = side * 0.12;
      const hand = box(scene, `sahur-hand-${side}-${id}`, 0.09, 0.1, 0.09, stick, m);
      hand.position.y = -ARM_LENGTH / 2 - 0.03;
      return m;
    };
    this.armL = arm(-1);
    this.armR = arm(1);

    // The bat: a tapered club in the right hand, hanging forward and down past the knee.
    this.bat = MeshBuilder.CreateCylinder(
      `sahur-bat-${id}`,
      { diameterTop: 0.05, diameterBottom: 0.11, height: 1.0, tessellation: 8 },
      scene,
    );
    this.bat.convertToFlatShadedMesh();
    this.bat.material = pale;
    this.bat.parent = this.armR;
    this.bat.position.set(0, -ARM_LENGTH / 2 - 0.35, 0.18);
    this.bat.rotation.x = 0.45;
    this.bat.isPickable = false;

    // A held item goes in the right hand instead of the bat; the flamethrower's tank rides on the back.
    this.items = new HeldItems(
      engine,
      `sahur-${id}`,
      this.armR,
      new Vector3(0, -ARM_LENGTH / 2 - 0.02, 0.04),
      this.log,
      new Vector3(0, SHOULDER_Y - HIP - 0.1, -(RADIUS + 0.1)),
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

    // Stilted walk: stiff legs swing from the hip and the log bobs, but the arms just hang.
    if (moved > 0.002 && !airborne) this.phase += moved * 3.2;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const swing = airborne ? 0.25 : Math.sin(this.phase) * 0.38 * effort;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.log.position.y = HIP + (airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.07 * effort);

    // The log leans a little with the look and sways slowly; every few seconds, a short jerk sideways.
    const now = performance.now();
    const sinceTwitch = (now + this.twitchOffset) % TWITCH_EVERY_MS;
    const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
    this.log.rotation.set(p.pitch * 0.15, 0, Math.sin(now / 1700 + this.twitchOffset) * 0.035 + twitch);

    this.armL.rotation.x = 0;
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : 0;
    this.bat.setEnabled(!p.item);
    this.items.update(p.item, p.firing);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen flat on its back like a felled log, face to the sky; lifted by its radius to lie on
      // the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? RADIUS : 0;
    }
    if (p.dead) {
      this.legL.rotation.x = this.legR.rotation.x = 0;
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

// The log from the hips up: slightly narrower at the bottom, straight sides, a rounded top. Nine
// sides and flat shading keep it rough-hewn.
function logMesh(scene: Engine['scene'], name: string, parent: TransformNode, mat: ReturnType<typeof flat>): Mesh {
  const top = HEIGHT - HIP;
  const shape = [
    new Vector3(0, 0, 0),
    new Vector3(RADIUS * 0.88, 0, 0),
    new Vector3(RADIUS, 0.25, 0),
    new Vector3(RADIUS, top - 0.14, 0),
    new Vector3(RADIUS * 0.8, top - 0.03, 0),
    new Vector3(RADIUS * 0.4, top, 0),
    new Vector3(0, top, 0),
  ];
  const m = MeshBuilder.CreateLathe(name, { shape, tessellation: 9, sideOrientation: Mesh.DOUBLESIDE }, scene);
  m.convertToFlatShadedMesh();
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// Wood: tan with darker grain running up the log in uneven streaks, a few knots, pixel-sized.
function grainTexture(scene: Engine['scene'], name: string): DynamicTexture {
  const size = 32;
  const tex = new DynamicTexture(name, size, scene, false, Texture.NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#c98c4f';
  ctx.fillRect(0, 0, size, size);
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let x = 0; x < size; x++) {
    if (rng() < 0.35) {
      ctx.fillStyle = rng() < 0.5 ? '#a86f3a' : '#b67b42';
      for (let y = 0; y < size; y++) if (rng() < 0.85) ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let k = 0; k < 3; k++) {
    ctx.fillStyle = '#7d4f28';
    ctx.fillRect(Math.floor(rng() * (size - 2)), Math.floor(rng() * (size - 3)), 2, 3);
  }
  tex.update();
  return tex;
}

// A thin disc facing +z, for the irises and pupils.
function disc(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: ReturnType<typeof flat>,
  diameter: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(name, { diameter, height: 0.01, tessellation: 10 }, scene);
  m.rotation.x = Math.PI / 2;
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}
