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
import {
  Bone,
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Skeleton,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import { ITEMS, SPINE_POINTS, WORLD_STRUCTURES, lookDirection, type ItemAction } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { FlameJet } from '../FlameJet';
import type { Avatar } from './common';
import { HitFlash } from './HitFlash';
import { bytes, skinMaterial } from './skinned';

const TEXTURE = '/assets/textures/avatars/light-dragon.png';
const JAW = SPINE_POINTS + 1; // the lower jaw's bone, after the head's and the spine's
const BONES = JAW + 1;
// The neck: how many bones behind the head turn with it rather than along the spine, the first
// almost all the way and each less than the last, so a turn of the head bends them evenly.
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
const JAW_OPEN = 0.7;
const JAW_EASE = 0.15;
// Inside it, in the head bone's frame along the lip line from the hinge to the tip: the roof and
// the floor of the mouth (a dark wedge each, as wide as the snout just inside its skin, this tall
// above and below the lip line at the hinge end, and at the tip, and a little apart at the line so
// they don't fight when the mouth is shut), a row of teeth either side of the roof, and the tongue
// on the floor.
const MOUTH_WIDTH = [0.9, 0.26];
const MOUTH_ROOF = [0.3, 0.04];
const MOUTH_FLOOR = [0.1, 0.06];
const MOUTH_GAP = 0.015;
const TEETH = 7;
const TOOTH = 0.12; // long
const TONGUE_WIDTH = [0.5, 0.16];
const TONGUE = 0.08; // thick
const MOUTH_DARK = [0.08, 0.1, 0.24];
const TOOTH_WHITE = [0.95, 0.93, 0.85];
const TONGUE_PINK = [0.85, 0.35, 0.45];
// The breath: how many times the flamethrower's blocks, how many times their size, how much they
// keep to the middle of the cone, and seconds it keeps pouring after the last tick that said so,
// over a tick the sim ran without the rider's frame.
const BREATH = { density: 3, size: 1.6, core: 2.5 };
const BREATH_HOLD = 0.2;
// The sleeve: a plain tube of mane colour round the neck inside the mane, so the gaps between its
// strands show gold rather than the sky. Rings on the first bones, each at a radius inside the
// strands' spread there (the neck itself is thinner), with the mane's texture at one spot.
const SLEEVE = [
  { bone: 0, along: -0.35, radius: 0.5 },
  { bone: 1, along: 0, radius: 0.72 },
  { bone: 2, along: 0, radius: 0.72 },
  { bone: 3, along: 0, radius: 0.68 },
];
const SLEEVE_SIDES = 10;
const SLEEVE_UV = [0.18, 0.77];
// The portal: metres across, how far under the ground a spine point counts as still in it, and
// seconds it takes to open or close.
const PORTAL = 7;
const PORTAL_DEPTH = 0.3;
const PORTAL_FADE = 0.6;

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
  private readonly portal: Mesh;
  private readonly portalMaterial: StandardMaterial;
  private portalOpen = 0; // 0 shut to 1 open
  private roaredAt = -Infinity;
  private roarSeconds = 0;
  private rose = false; // roared its way out of the ground
  private jaw = 0; // 0 shut to 1 open
  private breathUntil = -Infinity;
  private hinge = new Vector3(); // the jaw's, in the head bone's frame
  private skeleton: Skeleton | null = null;
  private head: Mesh | null = null;
  private sleeve: Mesh | null = null;
  private mouthInside: Mesh | null = null;
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
    this.portal = MeshBuilder.CreateDisc(`dragon-${id}-portal`, { radius: PORTAL / 2, tessellation: 32 }, scene);
    this.portal.rotation.x = Math.PI / 2;
    this.portal.isPickable = false;
    this.portalMaterial = portalMaterial(engine, `dragon-${id}-portal`);
    this.portal.material = this.portalMaterial;
    this.portal.setEnabled(false);
    engine.glowLayer.addIncludedOnlyMesh(this.portal);
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
    mesh('body', m.body);
    this.sleeve = new Mesh(`dragon-${this.id}-sleeve`, scene);
    sleeveData(m.frames).applyToMesh(this.sleeve);
    this.sleeve.material = material;
    this.sleeve.skeleton = this.skeleton;
    this.sleeve.parent = this.root;
    this.sleeve.isPickable = false;
    this.sleeve.alwaysSelectAsActiveMesh = true;
    this.mouthInside = new Mesh(`dragon-${this.id}-mouth-inside`, scene);
    mouthData(headRest, this.hinge, this.mouth.position).applyToMesh(this.mouthInside);
    this.mouthInside.material = mouthMaterial(engine);
    this.mouthInside.skeleton = this.skeleton;
    this.mouthInside.parent = this.root;
    this.mouthInside.isPickable = false;
    this.mouthInside.alwaysSelectAsActiveMesh = true;
    for (const m of [this.head, this.sleeve, this.mouthInside]) m.setEnabled(!this.headless);
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
    const look = d ? d.head : lookDirection(p.yaw, p.pitch);
    let forward = new Vector3(look.x, look.y, look.z);
    let up = Vector3.Up().subtract(forward.scale(forward.y));
    // Pointing straight up or down (climbing out of the ground), the head has no lean to take its
    // up from: its back faces away from the look, as it does just short of vertical.
    if (up.lengthSquared() < 1e-6) up.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    up.normalize();
    const lift = this.dead ? 0 : this.roarLift(now);
    if (lift > 0) {
      forward = forward.scale(Math.cos(lift)).addInPlace(up.scale(Math.sin(lift)));
      up = Vector3.Up().subtract(forward.scale(forward.y)).normalize();
    }
    this.place(0, this.at, up, forward);
    if (!p.dead && p.firing && p.item === 'firebreath') this.breathUntil = now + BREATH_HOLD * 1000;
    const breathing = now < this.breathUntil;
    this.updateJaw(now, dt, breathing, up, forward);
    const spine = d?.spine ?? [];
    this.updatePortal(spine, dt);
    const wave = ((performance.now() / 1000 / WAVE_SECONDS + this.phase) % 1) * 2 * Math.PI;
    let last = this.at;
    for (let i = 1; i <= SPINE_POINTS; i++) {
      const k = (i - 1) * 3;
      const next = k + 3 < spine.length ? new Vector3(spine[k + 3], spine[k + 4], spine[k + 5]) : null;
      const here = new Vector3(spine[k], spine[k + 1], spine[k + 2]);
      // Along the spine, from the point behind to the one ahead; the neck leans toward the head.
      const along = (next ? last.subtract(next) : last.subtract(here)).normalize();
      const lean = i <= NECK_BONES ? 1 - i / (NECK_BONES + 1) : 0;
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
    this.jet.set(breathing);
    this.jet.update(dt);
    this.root.setEnabled(true);
  }

  // The lower jaw hangs from its hinge in the head, dropped open to breathe or roar.
  private updateJaw(now: number, dt: number, breathing: boolean, up: Vector3, forward: Vector3): void {
    const t = (now - this.roaredAt) / 1000;
    const want = !this.dead && (breathing || (t >= 0 && t < this.roarSeconds - ROAR_SHUT)) ? 1 : 0;
    this.jaw += (want - this.jaw) * Math.min(1, dt / JAW_EASE);
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

  // The portal lies where the body goes into the ground, open while any of it is still down there,
  // turning slowly, and fades shut once the tail is out.
  private updatePortal(spine: number[], dt: number): void {
    const ground = WORLD_STRUCTURES.groundAt(this.at.x, this.at.z, this.at.y);
    let under: number | null = null;
    for (let i = 0; i < spine.length; i += 3)
      if (spine[i + 1] < ground - PORTAL_DEPTH) {
        under = i;
        break;
      }
    const want = under === null || this.dead ? 0 : 1;
    this.portalOpen = Math.max(0, Math.min(1, this.portalOpen + ((want ? 1 : -1) * dt) / PORTAL_FADE));
    if (under !== null) this.portal.position.set(spine[under], ground + 0.04, spine[under + 2]);
    this.portal.setEnabled(this.portalOpen > 0);
    this.portalMaterial.alpha = this.portalOpen;
    this.portal.rotation.y += dt * 0.5;
    this.portal.scaling.setAll(0.6 + 0.4 * this.portalOpen);
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
    for (const m of [this.head, this.sleeve, this.mouthInside]) m?.setEnabled(!on);
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
    this.portal.dispose(false, true);
    this.root.dispose(false, true);
    this.skeleton?.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? this.at.clone() : null;
  }
}

const SCRATCH = new Matrix();

// The inside of the mouth takes its colours from its vertices, lit a little by itself so it reads
// in the dark like the skin. Made once and shared.
let mouthMat: StandardMaterial | null = null;
function mouthMaterial(engine: Engine): StandardMaterial {
  if (mouthMat) return mouthMat;
  mouthMat = new StandardMaterial('dragon-mouth', engine.scene);
  mouthMat.emissiveColor = new Color3(0.18, 0.18, 0.18);
  mouthMat.specularColor = Color3.Black();
  mouthMat.backFaceCulling = false;
  return mouthMat;
}

// The inside of the mouth in the rest pose, the roof and teeth following the head bone and the
// floor and tongue the jaw's. `hinge` and `tip` are in the head bone's frame (x right, y up, z
// forward); the lip line runs between them.
function mouthData(headRest: Matrix, hinge: Vector3, tip: Vector3): VertexData {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const bones: number[] = [];
  const weights: number[] = [];
  const slope = (tip.y - hinge.y) / (tip.z - hinge.z);
  const lip = (z: number) => hinge.y + (z - hinge.z) * slope;
  const vertex = (x: number, y: number, z: number, bone: number, rgb: number[]): number => {
    const p = Vector3.TransformCoordinates(new Vector3(x, y, z), headRest);
    positions.push(p.x, p.y, p.z);
    colors.push(rgb[0], rgb[1], rgb[2], 1);
    bones.push(bone, 0, 0, 0);
    weights.push(1, 0, 0, 0);
    return positions.length / 3 - 1;
  };
  // A wedge between two cross-sections, each centred on the lip line at `z`, `w` wide and running
  // from `bottom` to `top` above it (negative is below).
  const wedge = (
    z0: number,
    z1: number,
    w: [number, number],
    bottom: [number, number],
    top: [number, number],
    bone: number,
    rgb: number[],
  ) => {
    const ring = (z: number, hw: number, b: number, t: number) => [
      vertex(-hw, lip(z) + b, z, bone, rgb),
      vertex(hw, lip(z) + b, z, bone, rgb),
      vertex(hw, lip(z) + t, z, bone, rgb),
      vertex(-hw, lip(z) + t, z, bone, rgb),
    ];
    const a = ring(z0, w[0] / 2, bottom[0], top[0]);
    const b = ring(z1, w[1] / 2, bottom[1], top[1]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      indices.push(a[i], a[j], b[i], a[j], b[j], b[i]);
    }
    indices.push(a[0], a[2], a[1], a[0], a[3], a[2], b[0], b[1], b[2], b[0], b[2], b[3]);
  };
  const z0 = hinge.z + 0.08;
  const z1 = tip.z - 0.12;
  const width: [number, number] = [MOUTH_WIDTH[0], MOUTH_WIDTH[1]];
  wedge(z0, z1, width, [MOUTH_GAP, MOUTH_GAP], [MOUTH_ROOF[0], MOUTH_ROOF[1]], 0, MOUTH_DARK);
  wedge(z0, z1, width, [-MOUTH_FLOOR[0], -MOUTH_FLOOR[1]], [-MOUTH_GAP, -MOUTH_GAP], JAW, MOUTH_DARK);
  wedge(
    z0 + 0.1,
    z1 - 0.06,
    [TONGUE_WIDTH[0], TONGUE_WIDTH[1]],
    [-0.02, -0.02],
    [TONGUE, TONGUE * 0.5],
    JAW,
    TONGUE_PINK,
  );
  // Teeth: triangles hanging from the roof's edges, in a row each side, pointing down.
  for (let i = 0; i < TEETH; i++) {
    const z = z0 + 0.12 + ((z1 - z0 - 0.24) * (i + 0.5)) / TEETH;
    const hw = (MOUTH_WIDTH[0] + ((MOUTH_WIDTH[1] - MOUTH_WIDTH[0]) * (z - z0)) / (z1 - z0)) / 2 - 0.02;
    for (const side of [-1, 1]) {
      const a = vertex(side * hw, lip(z) + MOUTH_GAP, z - 0.05, 0, TOOTH_WHITE);
      const b = vertex(side * hw, lip(z) + MOUTH_GAP, z + 0.05, 0, TOOTH_WHITE);
      const c = vertex(side * (hw - 0.04), lip(z) - TOOTH, z, 0, TOOTH_WHITE);
      indices.push(a, b, c, a, c, b);
    }
  }
  const data = new VertexData();
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.matricesIndices = bones;
  data.matricesWeights = weights;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  data.normals = normals;
  return data;
}

// Pale gold light: a soft disc with a brighter rim, drawn once and shared.
let portalTexture: DynamicTexture | null = null;
function portalMaterial(engine: Engine, name: string): StandardMaterial {
  const scene = engine.scene;
  if (!portalTexture) {
    const size = 128;
    portalTexture = new DynamicTexture('portalTex', size, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    portalTexture.hasAlpha = true;
    const ctx = portalTexture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,250,220,0.85)');
    g.addColorStop(0.55, 'rgba(255,230,150,0.45)');
    g.addColorStop(0.82, 'rgba(255,240,190,0.95)');
    g.addColorStop(0.9, 'rgba(255,215,120,0.6)');
    g.addColorStop(1, 'rgba(255,215,120,0)');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    portalTexture.update();
  }
  const m = new StandardMaterial(name, scene);
  m.diffuseTexture = portalTexture;
  m.opacityTexture = portalTexture;
  m.emissiveTexture = portalTexture;
  m.emissiveColor = new Color3(1, 0.95, 0.75);
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

// The sleeve in the rest pose, each ring's vertices following its bone alone.
function sleeveData(frames: readonly number[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bones: number[] = [];
  const weights: number[] = [];
  for (const ring of SLEEVE) {
    const f = frames.slice(ring.bone * 12, ring.bone * 12 + 12);
    for (let i = 0; i < SLEEVE_SIDES; i++) {
      const a = (i / SLEEVE_SIDES) * 2 * Math.PI;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (let k = 0; k < 3; k++) {
        normals.push(c * f[3 + k] + s * f[6 + k]);
        positions.push(f[k] + f[9 + k] * ring.along + ring.radius * normals[normals.length - 1]);
      }
      uvs.push(SLEEVE_UV[0], SLEEVE_UV[1]);
      bones.push(ring.bone, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  }
  for (let r = 0; r + 1 < SLEEVE.length; r++)
    for (let i = 0; i < SLEEVE_SIDES; i++) {
      const a = r * SLEEVE_SIDES + i;
      const b = r * SLEEVE_SIDES + ((i + 1) % SLEEVE_SIDES);
      indices.push(a, b, a + SLEEVE_SIDES, b, b + SLEEVE_SIDES, a + SLEEVE_SIDES);
    }
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.matricesIndices = bones;
  data.matricesWeights = weights;
  return data;
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
