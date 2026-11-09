// A dragon in the sky: its skin's model (dragons.ts) skinned over a bone at the eyes, bones along
// the spine the sim moves (sim/dragon.ts), each where the model says it sits on the body, and bones
// hung on those for the parts that move on their own (the lower jaw). The head points where the sim
// says (the look, as far as the neck lets it) and the neck bends evenly after it; the body is drawn
// along the spine, its back kept up the way the head's is, with the skin's slow wave running down
// it so it never hangs still. Its breath (the look's own hold item, fire or frost) pours from the
// open mouth while it's breathing, and it lifts its head and opens its mouth to roar: on its
// rider's key, and as it rises out of the ground, through whatever its skin rises through, open
// until the whole of it is out. A weak point the sim says is shattered loses its pieces here in a
// burst of shards. What shots have to hit is the class's (sim/dragon.ts), not anything drawn here.
import { Bone, Matrix, Mesh, Quaternion, Skeleton, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import {
  AVATARS,
  ITEMS,
  WORLD_STRUCTURES,
  dragonShape,
  lookDirection,
  weakPointAt,
  type AvatarId,
  type DragonState,
  type ItemAction,
  type ItemId,
  type Vec3,
} from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { coneAngle, createJet, type Jet } from '../Jet';
import { shards } from '../Poof';
import type { Avatar } from './common';
import type { DragonLook, DragonModel, MeshData, Rise } from './dragons';
import { HitFlash } from './HitFlash';
import { bytes, skinMaterial } from './skinned';

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
// The breath: how many times a hand weapon's particles, how many times their size, how much a
// flame's keep to the middle of the cone, and seconds it keeps pouring after the last tick that
// said so, over a tick the sim ran without the rider's frame.
const BREATH = { density: 3, size: 1.6, core: 2.5 };
const BREATH_HOLD = 0.2;

export class DragonAvatar implements Avatar {
  private readonly root: TransformNode;
  private readonly bones: TransformNode[] = [];
  private readonly mouth: TransformNode;
  private readonly breath: ItemId | null; // the look's own hold item, breathed from the mouth
  private readonly jet: Jet | null;
  private readonly rise: Rise;
  private readonly links: readonly number[]; // the sim's spine: metres between its points
  private model: DragonModel | null = null;
  private weak: { crown: Mesh; plate: Mesh }[] = [];
  private readonly gone = new Set<number>(); // the weak points shattered, their pieces hidden
  private seen = false; // past the first update: a weak point shattered after that bursts
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
    private readonly engine: Engine,
    readonly id: string,
    readonly kind: AvatarId, // the skin worn: its atlas paints the model
    private readonly look: DragonLook,
  ) {
    const scene = engine.scene;
    this.links = dragonShape(kind).links;
    this.phase = ([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % 1000) / 1000;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.mouth = new TransformNode(`dragon-${id}-mouth`, scene);
    this.mouth.parent = this.root;
    const own = AVATARS[kind].item;
    const spec = own && ITEMS[own];
    const element = spec && spec.actions.shoot?.mode === 'hold' ? spec.element : null;
    this.breath = element && own ? own : null;
    this.jet =
      spec && element
        ? createJet(engine, `dragon-${id}`, this.mouth, element, spec.range, coneAngle(spec), BREATH)
        : null;
    this.rise = look.rise(engine, `dragon-${id}-rise`);
    void look.model().then((m) => this.build(engine, m));
  }

  // The skin, once the model has arrived: a node per bone, parented like the bones, whose rest pose
  // is its bind pose, so a node put at a live frame carries its stretch of the body there. A bone on
  // the spine is a root node the renderer places outright; one hung on a parent is that node's
  // child, left at its rest pose unless something moves it (the jaw).
  private build(engine: Engine, m: DragonModel): void {
    if (this.disposed) return;
    const scene = engine.scene;
    this.model = m;
    this.skeleton = new Skeleton(`dragon-${this.id}`, `dragon-${this.id}`, scene);
    this.skeleton.useTextureToStoreBoneMatrices = false;
    const bones: Bone[] = [];
    m.parent.forEach((parent, i) => {
      const node = new TransformNode(`dragon-${this.id}-${i}`, scene);
      node.rotationQuaternion = Quaternion.Identity();
      const rest = frameMatrix(m.frames, i);
      const local = parent === null ? rest : rest.multiply(Matrix.Invert(frameMatrix(m.frames, parent)));
      if (parent === null) node.parent = this.root;
      else {
        node.parent = this.bones[parent];
        local.decompose(undefined, node.rotationQuaternion, node.position);
      }
      const bone = new Bone(
        `dragon-${this.id}-${i}`,
        this.skeleton!,
        parent === null ? null : bones[parent],
        local,
        null,
        null,
        i,
      );
      bone.linkTransformNode(node);
      bones.push(bone);
      this.bones.push(node);
    });
    const toHead = Matrix.Invert(frameMatrix(m.frames, 0));
    this.mouth.parent = this.bones[0];
    this.mouth.position = Vector3.TransformCoordinates(new Vector3(...m.mouth), toHead);
    if (m.jaw !== null)
      this.hinge = Vector3.TransformCoordinates(frameMatrix(m.frames, m.jaw).getTranslation(), toHead);
    const material = skinMaterial(scene, `dragon-${this.id}`, this.kind);
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
    this.maw = m.maw && mesh('maw', m.maw);
    const body = mesh('body', m.body);
    this.weak = m.weak.map((w, n) => ({ crown: mesh(`crown-${n}`, w.crown), plate: mesh(`plate-${n}`, w.plate) }));
    for (const n of this.gone) this.hideWeak(n);
    this.head.setEnabled(!this.headless);
    this.maw?.setEnabled(false);
    this.rise.mirror?.([this.head, body, ...this.weak.flatMap((w) => [w.crown, w.plate])]);
  }

  private hideWeak(n: number): void {
    this.weak[n]?.crown.setEnabled(false);
    this.weak[n]?.plate.setEnabled(false);
  }

  // The weak points shot out since the last frame lose their pieces, in a burst of shards at the
  // spot; the ones already gone when the body first shows just stay gone.
  private shatter(p: RemotePlayer, d: DragonState): void {
    for (const n of d.shattered) {
      if (this.gone.has(n)) continue;
      this.gone.add(n);
      this.hideWeak(n);
      const at = this.seen ? weakPointAt({ x: p.x, y: p.y, z: p.z }, d.spine, dragonShape(this.kind).weak[n]) : null;
      if (at) shards(this.engine, new Vector3(at.x, at.y, at.z));
    }
    this.seen = true;
  }

  update(p: RemotePlayer): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.hitFlash?.update(p.chilled);
    this.dead = p.dead;
    this.at.set(p.x, p.y, p.z);
    const d = p.dragon;
    if (d && !d.risen && !this.rose) {
      this.rose = true;
      this.roar(CRY_SECONDS);
    }
    if (!p.dead && p.firing && p.item !== null && p.item === this.breath) this.breathUntil = now + BREATH_HOLD * 1000;
    const breathing = now < this.breathUntil;
    this.rise.update(
      this.at,
      WORLD_STRUCTURES.groundAt(this.at.x, this.at.z, this.at.y),
      !!d && !d.risen && !this.dead,
      dt,
    );
    if (d) this.shatter(p, d);
    if (this.model) this.pose(this.model, p, now, dt, breathing);
    this.jet?.set(breathing);
    this.jet?.update(dt);
    this.root.setEnabled(true);
  }

  // Every bone at its live frame: the head's where the sim points it, the spine's along the spine,
  // and the jaw's on its hinge.
  private pose(m: DragonModel, p: RemotePlayer, now: number, dt: number, breathing: boolean): void {
    const d = p.dragon;
    const head = headFrame(d ? d.head : lookDirection(p.yaw, p.pitch), p.yaw, this.dead ? 0 : this.roarLift(now));
    this.place(0, this.at, head.up, head.forward);
    this.updateJaw(m, now, dt, breathing);
    const wave = this.look.wave;
    const turn = wave ? ((now / 1000 / wave.seconds + this.phase) % 1) * 2 * Math.PI : 0;
    let up = head.up;
    const spine = d?.spine ?? [];
    spineFrames(this.at, head.forward, spine, this.links, m.along, m.neck).forEach(({ bone, at, forward }, n) => {
      // The back stays up: the up carried along from the head, squared to each bone's forward.
      up = up.subtract(forward.scale(Vector3.Dot(forward, up)));
      if (up.lengthSquared() < 1e-6) up = Vector3.Cross(forward, Vector3.Right());
      up.normalize();
      const i = n + 1;
      const rise =
        wave && !p.dead ? wave.size * Math.min(1, i / wave.from) * Math.sin(turn - (i * 2 * Math.PI) / wave.bones) : 0;
      this.place(bone, at.add(up.scale(rise)), up, forward);
    });
  }

  // The lower jaw hangs from its hinge in the head, dropped open to breathe or roar: turned down
  // about the head's right axis, in the head bone's frame.
  private updateJaw(m: DragonModel, now: number, dt: number, breathing: boolean): void {
    const t = (now - this.roaredAt) / 1000;
    const want = !this.dead && (breathing || (t >= 0 && t < this.roarSeconds - ROAR_SHUT)) ? 1 : 0;
    this.jaw += (want - this.jaw) * Math.min(1, dt / JAW_EASE);
    this.maw?.setEnabled(!this.headless && this.jaw > 0.02);
    if (m.jaw === null) return;
    const open = JAW_OPEN * this.jaw;
    this.place(
      m.jaw,
      this.hinge,
      new Vector3(0, Math.cos(open), Math.sin(open)),
      new Vector3(0, -Math.sin(open), Math.cos(open)),
    );
  }

  // How far the head is up for a roar: quickly up, then slowly down.
  private roarLift(now: number): number {
    const t = (now - this.roaredAt) / 1000;
    if (t < 0 || t > ROAR_RISE + ROAR_SETTLE) return 0;
    if (t < ROAR_RISE) return ROAR_LIFT * Math.sin((t / ROAR_RISE) * (Math.PI / 2));
    const s = (t - ROAR_RISE) / ROAR_SETTLE;
    return ROAR_LIFT * (1 - s * s * (3 - 2 * s));
  }

  // Puts bone i's node at a frame: in the world for a bone on the spine, in its parent's frame for
  // one hung on another.
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

  scaleWeapons(): void {}

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.disposed = true;
    this.jet?.dispose();
    this.rise.dispose();
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
// the look, as it does just short of vertical. The lift turns the frame as one about its right
// axis, so the back stays put through a roar: a vertical head's, taken from the lifted forward,
// would come round to the other side.
function headFrame(look: Vec3, yaw: number, lift: number): Frame {
  const forward = new Vector3(look.x, look.y, look.z);
  const up = Vector3.Up().subtract(forward.scale(forward.y));
  if (up.lengthSquared() < 1e-6) up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  up.normalize();
  if (lift <= 0) return { up, forward };
  return {
    forward: forward.scale(Math.cos(lift)).addInPlace(up.scale(Math.sin(lift))),
    up: up.scale(Math.cos(lift)).subtractInPlace(forward.scale(Math.sin(lift))),
  };
}

// Where each bone on the spine goes and which way it points, nearest the head first: `along`
// metres behind the eyes, between the spine points either side of that (the points lie `links`
// apart along the spine, from the head), pointing from the point behind to the one ahead; except
// the neck's, which lie on a curve from the head, leaving it the way the head points and arriving
// the way the spine runs past the neck, so a turn of the head bends the neck, most just behind the
// head and less each bone back, and the skin follows the bend.
function spineFrames(
  head: Vector3,
  forward: Vector3,
  spine: readonly number[],
  links: readonly number[],
  along: readonly (number | null)[],
  neck: number,
): { bone: number; at: Vector3; forward: Vector3 }[] {
  const points = [head];
  for (let k = 0; k + 2 < spine.length; k += 3) points.push(new Vector3(spine[k], spine[k + 1], spine[k + 2]));
  const behind = [0]; // how far behind the eyes each point is
  for (let k = 1; k < points.length; k++) behind.push(behind[k - 1] + (links[k - 1] ?? 0));
  const last = points.length - 1;
  // Along the spine at point i: from the point behind it to the one ahead.
  const dirAt = (i: number) => points[Math.max(i - 1, 0)].subtract(points[Math.min(i + 1, last)]).normalize();
  // The frame `s` metres behind the eyes: between the points either side.
  const frameAt = (s: number) => {
    let k = 0;
    while (k < last - 1 && behind[k + 1] < s) k++;
    const span = behind[k + 1] - behind[k];
    const t = span > 0 ? Math.max(0, Math.min(1, (s - behind[k]) / span)) : 0;
    return {
      at: Vector3.Lerp(points[k], points[Math.min(k + 1, last)], t),
      forward: Vector3.Lerp(dirAt(k), dirAt(Math.min(k + 1, last)), t).normalize(),
    };
  };
  const bones = along.flatMap((s, bone) => (s !== null && bone > 0 ? [{ bone, s }] : []));
  const frames = bones.map(({ bone, s }) => ({ bone, ...frameAt(s) }));
  if (points.length > 1 && frames.length > neck) {
    const end = frames[neck];
    const length = Vector3.Distance(head, end.at);
    const t0 = forward.scale(-length);
    const t1 = end.forward.scale(-length);
    for (let i = 0; i < neck; i++) {
      const t = bones[i].s / bones[neck].s;
      frames[i] = {
        bone: bones[i].bone,
        at: Vector3.Hermite(head, t0, end.at, t1, t),
        forward: Vector3.Hermite1stDerivative(head, t0, end.at, t1, t).normalize().scaleInPlace(-1),
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
