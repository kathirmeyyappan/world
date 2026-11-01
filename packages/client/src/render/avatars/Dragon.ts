// The light dragon: a long serpent in the sky, from roboguts's Tears of the Kingdom model
// (dragonModel.ts, made by scripts/dragon-model.py), skinned over a bone at the eyes, one at each
// point of the spine the sim moves (sim/dragon.ts), and one for the lower jaw. The head points
// where the sim says (the look, as far as the neck lets it) and the neck bends evenly after it; the
// body is drawn along the spine, its back kept up the way the head's is, with a slow wave running
// down it so it never hangs still. Fire breath pours from the open mouth while it's breathing, and
// it lifts its head and opens its mouth to roar: on its rider's key, and as it rises out of the
// ground, where a portal of light lies open while any of the body is still down there. The model is
// a few hundred kilobytes, fetched the first time one appears. Worn with /light-dragon; what shots
// have to hit is the class's (sim/dragon.ts), not anything drawn here.
import { Bone, Matrix, Mesh, Quaternion, Skeleton, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { ITEMS, SPINE_POINTS, WORLD_STRUCTURES, lookDirection, type ItemAction, type Vec3 } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { FlameJet } from '../FlameJet';
import { Portal } from '../Portal';
import type { Avatar } from './common';
import { HitFlash } from './HitFlash';
import { bytes, skinMaterial } from './skinned';

const TEXTURE = '/assets/textures/avatars/light-dragon.png';
const JAW = SPINE_POINTS + 1; // the lower jaw's bone, after the head's and the spine's
const BONES = JAW + 1;
// The neck: how many bones behind the head lie on a curve from the way the head points to the way
// the spine runs, rather than on the spine itself, so a turn of the head bends them evenly.
const NECK_BONES = 6;
// The wave down the body: metres up and down at full size, bones per wavelength, seconds per
// wave, and the bone by which it is at full size (none at the neck, so the head stays put).
const WAVE = 0.3;
const WAVE_BONES = 7;
const WAVE_SECONDS = 2.6;
const WAVE_FROM = 4;
// A roar: the head comes up this far (radians) in ROAR_RISE seconds and settles over ROAR_SETTLE,
// with the mouth open until ROAR_SHUT seconds before the sound ends. The sounds' lengths are the
// clips' (audio/Sfx.ts).
const ROAR_LIFT = 0.28;
const ROAR_RISE = 0.25;
const ROAR_SETTLE = 2.2;
const ROAR_SHUT = 0.5;
const ROAR_SECONDS = 3;
const CRY_SECONDS = 3.7;
// The mouth: radians the jaw drops when open, and seconds it takes to open or shut.
const JAW_OPEN = 0.8;
const JAW_EASE = 0.15;
// The breath: how many times the flamethrower's blocks, how many times their size, how much they
// keep to the middle of the cone, and seconds it keeps pouring after the last tick that said so,
// over a tick the sim ran without the rider's frame.
const BREATH = { density: 3, size: 1.6, core: 2.5 };
const BREATH_HOLD = 0.2;

type DragonModel = typeof import('./dragonModel').DRAGON_MODEL;
interface MeshData {
  readonly positions: string;
  readonly normals: string;
  readonly uvs: string;
  readonly indices: string;
  readonly bones: string;
  readonly split: string;
}
let model: Promise<DragonModel> | null = null;

function loadModel(): Promise<DragonModel> {
  return (model ??= import('./dragonModel').then((m) => m.DRAGON_MODEL));
}

// Fetches the model once the page has nothing better to do, so the first dragon anyone sees rises
// with its skin on rather than a few seconds after.
export function preloadDragonModel(): void {
  const idle = window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 3000));
  idle(() => void loadModel());
}

export class DragonAvatar implements Avatar {
  readonly kind = 'light-dragon' as const;
  private readonly root: TransformNode;
  private readonly bones: TransformNode[] = [];
  private readonly mouth: TransformNode;
  private readonly jet: FlameJet;
  private readonly portal: Portal;
  private roaredAt = -Infinity;
  private roarSeconds = 0;
  private rose = false; // roared its way out of the ground
  private jaw = 0; // 0 shut to 1 open
  private breathUntil = -Infinity;
  private hinge = new Vector3(); // the jaw's, in the head bone's frame
  private skeleton: Skeleton | null = null;
  private head: Mesh | null = null;
  private maw: Mesh | null = null; // the inside of the mouth, drawn only while the jaw is open
  private hitFlash: HitFlash | null = null;
  private headless = false;
  private disposed = false;
  private dead = false;
  private readonly at = new Vector3();
  private readonly phase: number; // where in the wave this one starts, so no two move in step
  private lastNow = performance.now();

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    this.phase = ([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 1000) / 1000;
    this.root = new TransformNode(`avatar-${id}`, scene);
    for (let i = 0; i < BONES; i++) {
      const node = new TransformNode(`dragon-${id}-${i}`, scene);
      node.parent = this.root;
      node.rotationQuaternion = Quaternion.Identity();
      this.bones.push(node);
    }
    this.mouth = new TransformNode(`dragon-${id}-mouth`, scene);
    this.mouth.parent = this.bones[0];
    const breath = ITEMS['firebreath'];
    this.jet = new FlameJet(
      engine,
      `dragon-${id}`,
      this.mouth,
      breath.range,
      breath.fire.kind === 'cone' ? breath.fire.halfAngle : 0,
      BREATH,
    );
    this.portal = new Portal(engine, `dragon-${id}-portal`);
    void loadModel().then((m) => this.build(engine, m));
  }

  // The skin, once the model has arrived: every bone's rest frame is its bind pose, so a bone's
  // node put at a live frame carries its stretch of the body there.
  private build(engine: Engine, m: DragonModel): void {
    if (this.disposed) return;
    const scene = engine.scene;
    this.skeleton = new Skeleton(`dragon-${this.id}`, `dragon-${this.id}`, scene);
    this.skeleton.useTextureToStoreBoneMatrices = false;
    for (let i = 0; i < BONES; i++) {
      const rest = frameMatrix(m.frames, i);
      const bone = new Bone(`dragon-${this.id}-${i}`, this.skeleton, null, rest, null, null, i);
      bone.linkTransformNode(this.bones[i]);
    }
    const headRest = frameMatrix(m.frames, 0);
    const toHead = Matrix.Invert(headRest);
    this.mouth.position = Vector3.TransformCoordinates(new Vector3(...m.mouth), toHead);
    this.hinge = Vector3.TransformCoordinates(frameMatrix(m.frames, JAW).getTranslation(), toHead);
    const material = skinMaterial(scene, `dragon-${this.id}`, TEXTURE);
    material.backFaceCulling = false; // plates, strands and fins are open shells, seen from both sides
    this.hitFlash = new HitFlash([material]);
    const mesh = (name: string, data: MeshData) => {
      const mesh = new Mesh(`dragon-${this.id}-${name}`, scene);
      vertexData(data).applyToMesh(mesh);
      mesh.material = material;
      mesh.skeleton = this.skeleton;
      mesh.parent = this.root;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // its bounds are the rest pose's, wherever it flies
      return mesh;
    };
    this.head = mesh('head', m.head);
    this.maw = mesh('maw', m.maw);
    mesh('body', m.body);
    this.head.setEnabled(!this.headless);
    this.maw.setEnabled(false);
  }

  update(p: RemotePlayer): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.hitFlash?.update();
    this.dead = p.dead;
    this.at.set(p.x, p.y, p.z);
    const d = p.dragon;
    if (d && !d.risen && !this.rose) {
      this.rose = true;
      this.roar(CRY_SECONDS);
    }
    const head = headFrame(d ? d.head : lookDirection(p.yaw, p.pitch), p.yaw, this.dead ? 0 : this.roarLift(now));
    this.place(0, this.at, head.up, head.forward);
    if (!p.dead && p.firing && p.item === 'firebreath') this.breathUntil = now + BREATH_HOLD * 1000;
    const breathing = now < this.breathUntil;
    this.updateJaw(now, dt, breathing, head);
    const spine = d?.spine ?? [];
    this.portal.update(spine, WORLD_STRUCTURES.groundAt(this.at.x, this.at.z, this.at.y), this.dead, dt);
    const wave = ((now / 1000 / WAVE_SECONDS + this.phase) % 1) * 2 * Math.PI;
    let up = head.up;
    spineFrames(this.at, head.forward, spine).forEach(({ at, forward }, n) => {
      const i = n + 1;
      // The back stays up: the up carried along from the head, squared to each bone's forward.
      up = up.subtract(forward.scale(Vector3.Dot(forward, up)));
      if (up.lengthSquared() < 1e-6) up = Vector3.Cross(forward, Vector3.Right());
      up.normalize();
      const rise = p.dead ? 0 : WAVE * Math.min(1, i / WAVE_FROM) * Math.sin(wave - (i * 2 * Math.PI) / WAVE_BONES);
      this.place(i, at.add(up.scale(rise)), up, forward);
    });
    this.jet.set(breathing);
    this.jet.update(dt);
    this.root.setEnabled(true);
  }

  // The lower jaw hangs from its hinge in the head, dropped open to breathe or roar.
  private updateJaw(now: number, dt: number, breathing: boolean, { up, forward }: Frame): void {
    const t = (now - this.roaredAt) / 1000;
    const want = !this.dead && (breathing || (t >= 0 && t < this.roarSeconds - ROAR_SHUT)) ? 1 : 0;
    this.jaw += (want - this.jaw) * Math.min(1, dt / JAW_EASE);
    this.maw?.setEnabled(!this.headless && this.jaw > 0.02);
    const open = JAW_OPEN * this.jaw;
    const right = Vector3.Cross(up, forward);
    const hinge = this.at
      .add(right.scale(this.hinge.x))
      .addInPlace(up.scale(this.hinge.y))
      .addInPlace(forward.scale(this.hinge.z));
    const jawForward = forward.scale(Math.cos(open)).subtractInPlace(up.scale(Math.sin(open)));
    const jawUp = up.scale(Math.cos(open)).addInPlace(forward.scale(Math.sin(open)));
    this.place(JAW, hinge, jawUp, jawForward);
  }

  // How far the head is up for a roar: quickly up, then slowly down.
  private roarLift(now: number): number {
    const t = (now - this.roaredAt) / 1000;
    if (t < 0 || t > ROAR_RISE + ROAR_SETTLE) return 0;
    if (t < ROAR_RISE) return ROAR_LIFT * Math.sin((t / ROAR_RISE) * (Math.PI / 2));
    const s = (t - ROAR_RISE) / ROAR_SETTLE;
    return ROAR_LIFT * (1 - s * s * (3 - 2 * s));
  }

  // Puts bone i's node at a live frame.
  private place(i: number, at: Vector3, up: Vector3, forward: Vector3): void {
    const node = this.bones[i];
    const right = Vector3.Cross(up, forward);
    Quaternion.FromRotationMatrixToRef(Matrix.FromXYZAxesToRef(right, up, forward, SCRATCH), node.rotationQuaternion!);
    node.position.copyFrom(at);
  }

  private roar(seconds: number): void {
    this.roaredAt = performance.now();
    this.roarSeconds = seconds;
  }

  // Draws the body without the head: the rider's own view from its eyes.
  setHeadless(on: boolean): void {
    this.headless = on;
    this.head?.setEnabled(!on);
  }

  act(action: ItemAction): void {
    if (action.startsWith('roar')) this.roar(ROAR_SECONDS);
  }

  flash(): void {
    this.hitFlash?.trigger();
  }

  fire(): void {}

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.disposed = true;
    this.jet.dispose();
    this.portal.dispose();
    this.root.dispose(false, true);
    this.skeleton?.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? this.at.clone() : null;
  }
}

const SCRATCH = new Matrix();

// Which way a bone's back faces and which way it points.
interface Frame {
  up: Vector3;
  forward: Vector3;
}

// The head's frame for a look, lifted `lift` radians for a roar. Pointing straight up or down
// (climbing out of the ground), the head has no lean to take its up from: its back faces away from
// the look, as it does just short of vertical.
function headFrame(look: Vec3, yaw: number, lift: number): Frame {
  let forward = new Vector3(look.x, look.y, look.z);
  let up = Vector3.Up().subtract(forward.scale(forward.y));
  if (up.lengthSquared() < 1e-6) up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  up.normalize();
  if (lift > 0) {
    forward = forward.scale(Math.cos(lift)).addInPlace(up.scale(Math.sin(lift)));
    up = Vector3.Up().subtract(forward.scale(forward.y)).normalize();
  }
  return { up, forward };
}

// Where each spine bone goes and which way it points, nearest the head first: along the spine
// through its point, except the neck's, which lie on a curve from the head, leaving it the way the
// head points and arriving the way the spine runs past the neck, so a turn of the head bends the
// neck, most just behind the head and less each bone back, and the skin follows the bend.
function spineFrames(head: Vector3, forward: Vector3, spine: readonly number[]): { at: Vector3; forward: Vector3 }[] {
  const points = [head];
  for (let k = 0; k + 2 < spine.length; k += 3) points.push(new Vector3(spine[k], spine[k + 1], spine[k + 2]));
  // Along the spine at point i: from the point behind it to the one ahead.
  const along = (i: number) => points[i - 1].subtract(points[Math.min(i + 1, points.length - 1)]).normalize();
  const frames = points.slice(1).map((at, n) => ({ at, forward: along(n + 1) }));
  const end = NECK_BONES + 1;
  if (points.length > end) {
    const length = Vector3.Distance(head, points[end]);
    const t0 = forward.scale(-length);
    const t1 = along(end).scaleInPlace(-length);
    for (let i = 1; i <= NECK_BONES; i++) {
      const t = i / end;
      frames[i - 1] = {
        at: Vector3.Hermite(head, t0, points[end], t1, t),
        forward: Vector3.Hermite1stDerivative(head, t0, points[end], t1, t).normalize().scaleInPlace(-1),
      };
    }
  }
  return frames;
}

// Bone i's rest frame as a matrix: its right, up and forward axes and its position.
function frameMatrix(frames: readonly number[], i: number): Matrix {
  const f = frames.slice(i * 12, i * 12 + 12);
  const m = Matrix.FromXYZAxesToRef(
    new Vector3(f[3], f[4], f[5]),
    new Vector3(f[6], f[7], f[8]),
    new Vector3(f[9], f[10], f[11]),
    new Matrix(),
  );
  m.setTranslation(new Vector3(f[0], f[1], f[2]));
  return m;
}

const decoded = new Map<string, VertexData>();

// A mesh's arrays, decoded once per page; the two bones a vertex follows become the four Babylon skins with.
function vertexData(m: MeshData): VertexData {
  let data = decoded.get(m.positions);
  if (data) return data;
  data = new VertexData();
  data.positions = Array.from(new Int16Array(bytes(m.positions).buffer), (mm) => mm / 1000);
  data.normals = Array.from(new Int8Array(bytes(m.normals).buffer), (n) => n / 127);
  data.uvs = Array.from(new Uint16Array(bytes(m.uvs).buffer), (u) => u / 65535);
  data.indices = Array.from(new Uint16Array(bytes(m.indices).buffer));
  const bones = bytes(m.bones);
  const split = bytes(m.split);
  const indices: number[] = [];
  const weights: number[] = [];
  for (let v = 0; v < split.length; v++) {
    indices.push(bones[v * 2], bones[v * 2 + 1], 0, 0);
    weights.push(split[v] / 255, 1 - split[v] / 255, 0, 0);
  }
  data.matricesIndices = indices;
  data.matricesWeights = weights;
  decoded.set(m.positions, data);
  return data;
}
