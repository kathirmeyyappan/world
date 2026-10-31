// The light dragon: a long serpent in the sky, from roboguts's Tears of the Kingdom model
// (dragonModel.ts, made by scripts/dragon-model.py), skinned over a bone at the eyes and one at each
// point of the spine the sim moves (sim/dragon.ts). The head turns with the look and the neck bends
// after it; the body is drawn along the spine, its back kept up the way the head's is, with a slow
// wave running down it so it never hangs still. Fire breath pours from the mouth while it's
// breathing. The model is a few hundred kilobytes, fetched the first time one appears. Worn with
// /light-dragon; what shots have to hit is the class's (sim/dragon.ts), not anything drawn here.
import { Bone, Matrix, Mesh, Quaternion, Skeleton, TransformNode, Vector3, VertexData } from '@babylonjs/core';
import { ITEMS, SPINE_POINTS, lookDirection } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { FlameJet } from '../FlameJet';
import type { Avatar } from './common';
import { HitFlash } from './HitFlash';
import { bytes, skinMaterial } from './skinned';

const TEXTURE = '/assets/textures/avatars/light-dragon.png';
const BONES = SPINE_POINTS + 1;
// How far the first bones behind the head turn with it rather than along the spine: the neck.
const NECK_FOLLOW = [0.7, 0.4, 0.15];
// The wave down the body: metres up and down at full size, bones per wavelength, seconds per
// wave, and the bone by which it is at full size (none at the neck, so the head stays put).
const WAVE = 0.3;
const WAVE_BONES = 7;
const WAVE_SECONDS = 2.6;
const WAVE_FROM = 4;

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

export class DragonAvatar implements Avatar {
  readonly kind = 'light-dragon' as const;
  private readonly root: TransformNode;
  private readonly bones: TransformNode[] = [];
  private readonly mouth: TransformNode;
  private readonly jet: FlameJet;
  private skeleton: Skeleton | null = null;
  private head: Mesh | null = null;
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
    );
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
    this.mouth.position = Vector3.TransformCoordinates(new Vector3(...m.mouth), Matrix.Invert(headRest));
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
    mesh('body', m.body);
    this.head.setEnabled(!this.headless);
  }

  update(p: RemotePlayer): void {
    this.hitFlash?.update();
    this.dead = p.dead;
    this.at.set(p.x, p.y, p.z);
    const look = lookDirection(p.yaw, p.pitch);
    const forward = new Vector3(look.x, look.y, look.z);
    let up = Vector3.Up().subtract(forward.scale(forward.y)).normalize();
    this.place(0, this.at, up, forward);
    const spine = p.dragon?.spine ?? [];
    const wave = ((performance.now() / 1000 / WAVE_SECONDS + this.phase) % 1) * 2 * Math.PI;
    let last = this.at;
    for (let i = 1; i < BONES; i++) {
      const k = (i - 1) * 3;
      const next = k + 3 < spine.length ? new Vector3(spine[k + 3], spine[k + 4], spine[k + 5]) : null;
      const here = new Vector3(spine[k], spine[k + 1], spine[k + 2]);
      // Along the spine, from the point behind to the one ahead; the neck leans toward the look.
      const along = (next ? last.subtract(next) : last.subtract(here)).normalize();
      const lean = NECK_FOLLOW[i - 1] ?? 0;
      const f =
        lean > 0
          ? along
              .scale(1 - lean)
              .addInPlace(forward.scale(lean))
              .normalize()
          : along;
      // The back stays up: the up carried along from the head, squared to each bone's forward.
      up = up.subtract(f.scale(Vector3.Dot(f, up)));
      if (up.lengthSquared() < 1e-6) up = Vector3.Cross(f, Vector3.Right());
      up.normalize();
      const rise = p.dead ? 0 : WAVE * Math.min(1, i / WAVE_FROM) * Math.sin(wave - (i * 2 * Math.PI) / WAVE_BONES);
      this.place(i, here.add(up.scale(rise)), up, f);
      last = here;
    }
    this.jet.set(!p.dead && p.firing && p.item === 'firebreath');
    this.jet.update(Math.min(0.1, (performance.now() - this.lastNow) / 1000));
    this.lastNow = performance.now();
    this.root.setEnabled(true);
  }

  // Puts bone i's node at a live frame.
  private place(i: number, at: Vector3, up: Vector3, forward: Vector3): void {
    const node = this.bones[i];
    const right = Vector3.Cross(up, forward);
    Quaternion.FromRotationMatrixToRef(Matrix.FromXYZAxesToRef(right, up, forward, SCRATCH), node.rotationQuaternion!);
    node.position.copyFrom(at);
  }

  // Draws the body without the head: the rider's own view from its eyes.
  setHeadless(on: boolean): void {
    this.headless = on;
    this.head?.setEnabled(!on);
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
    this.root.dispose(false, true);
    this.skeleton?.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? this.at.clone() : null;
  }
}

const SCRATCH = new Matrix();

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
