// The ground a dragon rises out of, rippling: a patch of whatever it comes up through (the floor,
// or the top of a structure, the terrace's deck or a keep's roof) bent into rings that run outward
// from the body and die away toward the rim, heaved up round the body where it breaks through. It
// is drawn as that surface (the floor's own shader, or the structure's own material and its tops'
// texture mapping), so where it lies level it paints the very pixels under it and only the bending
// shows. Built when it opens, over just the stretch of that one surface round the body (not past
// a deck's edge, up a wall or onto another look), and dropped once it has settled shut.
import { Color3, Mesh, Vector3, VertexBuffer, VertexData, type Material } from '@babylonjs/core';
import { WORLD_STRUCTURES, type Structure } from '@world/shared';
import type { Rise } from './avatars/dragons';
import type { Engine } from './Engine';
import { environmentOf } from './Environment';
import { RELIEF_LIGHT, RELIEF_SIDE, RELIEF_TILT } from './shaders';
import { lookOf, structureMaterial, topUv, type Look } from './Structures';

const RINGS = 48; // rings of vertices from the middle out to the rim
const SEGMENTS = 128; // vertices round each ring
const WAVELENGTH = 5; // metres between crests
const SPEED = 7; // m/s the crests run outward
const HEIGHT = 0.9; // metres a crest stands at the body's edge, at full strength
const SHARPNESS = 2.5; // how narrow a crest is: the top of a cosine to this power
const HEAVE = 1.1; // metres the ground is heaved up round the body where it breaks through
const HEAVE_WIDTH = 1.6; // metres out from the body's edge the heave spreads
const LIFT = 0.004; // metres the level patch stands over the surface, in front of it, painting the same pixels
const SAME = 0.02; // metres: a spot whose ground is within this of the middle's is on the same surface
const STEP = 0.4; // metres over the surface its ground is read from at a spot

export interface RippleLook {
  across: number; // metres
  fade: number; // seconds to open or shut
  glow: Color3; // what the crests glow, added to the surface at a crest's full height
}

export class GroundRipple implements Rise {
  private open = 0; // 0 shut to 1 open
  private time = 0; // seconds since it opened, the waves' clock
  private patch: Patch | null = null;
  private tried = false; // a patch was asked for since it last shut (a surface it can't draw gets none)

  constructor(
    private readonly engine: Engine,
    private readonly name: string,
    private readonly hole: number, // metres across the middle the body comes up through, halved
    private readonly look: RippleLook,
  ) {}

  // `at` is over where the body comes out (its x and z), `ground` the surface there, and `open`
  // whether any of the body is still down in it.
  update(at: Vector3, ground: number, open: boolean, dt: number): void {
    this.open = Math.max(0, Math.min(1, this.open + ((open ? 1 : -1) * dt) / this.look.fade));
    if (open && !this.tried) {
      this.tried = true;
      this.time = 0;
      this.patch = Patch.make(this.engine, this.name, at.x, at.z, ground, this.look);
    }
    if (this.open === 0 && !open) {
      this.patch?.dispose();
      this.patch = null;
      this.tried = false;
      return;
    }
    this.time += dt;
    this.patch?.bend(this.time, this.open, this.hole, this.look.across / 2);
  }

  dispose(): void {
    this.patch?.dispose();
    this.patch = null;
  }
}

// The mesh: a disc of RINGS × SEGMENTS vertices round a middle one, with only the triangles over
// the surface kept, and each vertex's share of the bending (`weight`: none along the patch's ragged
// edge, so it meets the surface there level).
class Patch {
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array | null; // a structure's shade and glow (the floor's shader does its own)
  private readonly heights = new Float32Array(RINGS + 1); // per ring, this frame
  private readonly slopes = new Float32Array(RINGS + 1);

  private constructor(
    private readonly mesh: Mesh,
    private readonly release: () => void,
    private readonly x: number,
    private readonly z: number,
    private readonly y: number,
    private readonly weight: Float32Array,
    private readonly glow: Color3,
    floor: boolean,
  ) {
    const n = weight.length;
    this.positions = new Float32Array(n * 3);
    this.normals = new Float32Array(n * 3);
    this.colors = floor ? null : new Float32Array(n * 4);
  }

  // A patch of the surface at (x, z), `y` up, or null where it can't be drawn as it is drawn (a
  // hidden piece, a model's; or a scene with no floor shader).
  static make(engine: Engine, name: string, x: number, z: number, y: number, look: RippleLook): Patch | null {
    const scene = engine.scene;
    const list = WORLD_STRUCTURES.list;
    const pieceAt = (px: number, pz: number): number | null | undefined => {
      const f = WORLD_STRUCTURES.footing(px, pz, y + STEP);
      if (Math.abs(f.y - y) > SAME) return undefined;
      return f.piece;
    };
    const middle = pieceAt(x, z);
    if (middle === undefined) return null;
    const piece = middle === null ? null : list[middle];
    if (piece?.hidden) return null;
    const env = piece ? null : environmentOf(scene);
    if (!piece && !env) return null;
    const own: Look | null = piece ? lookOf(piece) : null;
    // Each vertex's piece, where it's on the same surface as the middle.
    const radius = look.across / 2;
    const count = 1 + RINGS * SEGMENTS;
    const pieces: (Structure | null | undefined)[] = [];
    const flat = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      const [px, pz] = spot(k, x, z, radius);
      flat.set([px, y + LIFT, pz], k * 3);
      const at = pieceAt(px, pz);
      const s = at === undefined || at === null ? at : list[at];
      const same = s === null ? own === null : s !== undefined && !s.hidden && lookOf(s) === own;
      pieces.push(same ? s : undefined);
    }
    const on = (k: number) => pieces[k] !== undefined;
    const weight = new Float32Array(count);
    for (let k = 0; k < count; k++) weight[k] = on(k) && neighbours(k).every(on) ? 1 : 0;
    const indices: number[] = [];
    const tri = (a: number, b: number, c: number) => {
      if (on(a) && on(b) && on(c)) indices.push(a, b, c);
    };
    for (let j = 0; j < SEGMENTS; j++) tri(0, vertex(1, j), vertex(1, j + 1));
    for (let i = 1; i < RINGS; i++)
      for (let j = 0; j < SEGMENTS; j++) {
        const [a, b, c, d] = [vertex(i, j), vertex(i, j + 1), vertex(i + 1, j), vertex(i + 1, j + 1)];
        tri(a, c, b);
        tri(b, c, d);
      }
    if (indices.length === 0) return null;
    const mesh = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = flat;
    data.normals = new Float32Array(count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));
    data.indices = indices;
    if (piece) {
      data.uvs = pieces.flatMap((s, k) => (s ? topUv(s, flat[k * 3], flat[k * 3 + 2]) : [0, 0]));
      data.colors = new Float32Array(count * 4).fill(1);
    }
    data.applyToMesh(mesh, true);
    mesh.isPickable = false;
    // Its bounds stand as tall as it ever bends, so it isn't culled while a crest is in view.
    mesh.buildBoundingInfo(
      new Vector3(x - radius, y, z - radius),
      new Vector3(x + radius, y + LIFT + HEAVE + HEIGHT, z + radius),
    );
    let material: Material;
    let release: () => void;
    if (env) {
      const ground = env.rippleGround(y + LIFT, HEIGHT, look.glow);
      material = ground;
      release = () => env.releaseGround(ground);
    } else {
      material = structureMaterial(scene, own!); // shared with the structures: never disposed here
      release = () => {};
    }
    mesh.material = material;
    return new Patch(mesh, release, x, z, y, weight, look.glow, !piece);
  }

  // The rings `time` seconds after opening, at `strength` (0 to 1) of their full height, round a
  // body `hole` metres in radius, dying away to nothing at `radius`.
  bend(time: number, strength: number, hole: number, radius: number): void {
    const height = (r: number) => {
      const d = Math.max(0, r - hole); // metres out from the body's edge
      const heave = HEAVE * Math.exp(-((d / HEAVE_WIDTH) ** 2));
      const crest = (0.5 + 0.5 * Math.cos((2 * Math.PI * (d - SPEED * time)) / WAVELENGTH)) ** SHARPNESS;
      const reached = Math.max(0, Math.min(1, (SPEED * time - d) / WAVELENGTH)); // the front grows in
      const fade = Math.max(0, 1 - d / Math.max(1e-6, radius - hole));
      return strength * (heave + HEIGHT * fade * reached * crest);
    };
    const step = radius / RINGS / 2;
    for (let i = 0; i <= RINGS; i++) {
      const r = (radius * i) / RINGS;
      this.heights[i] = height(r);
      this.slopes[i] = i === 0 ? 0 : (height(r + step) - height(r - step)) / (2 * step);
    }
    const n = this.weight.length;
    const normal = new Vector3();
    for (let k = 0; k < n; k++) {
      const [i, j] = ringOf(k);
      const w = this.weight[k];
      const a = (2 * Math.PI * j) / SEGMENTS;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      const r = (radius * i) / RINGS;
      const h = w * this.heights[i];
      this.positions[k * 3] = this.x + cos * r;
      this.positions[k * 3 + 1] = this.y + LIFT + h;
      this.positions[k * 3 + 2] = this.z + sin * r;
      const s = w * this.slopes[i];
      normal.set(-s * cos, 1, -s * sin).normalize();
      this.normals.set([normal.x, normal.y, normal.z], k * 3);
      if (this.colors) {
        const shade = reliefShade(normal);
        const lit = Math.min(1, h / HEIGHT);
        this.colors.set([shade + this.glow.r * lit, shade + this.glow.g * lit, shade + this.glow.b * lit, 1], k * 4);
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions);
    this.mesh.updateVerticesData(VertexBuffer.NormalKind, this.normals);
    if (this.colors) this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors);
  }

  dispose(): void {
    this.mesh.dispose(false, false);
    this.release();
  }
}

// The floor shader's reliefShade (shaders.ts), for a structure's top, shaded by its vertices.
function reliefShade(n: Vector3): number {
  return Math.max(0, 1 - RELIEF_TILT * (1 - n.y) + RELIEF_SIDE * (n.x * RELIEF_LIGHT.x + n.z * RELIEF_LIGHT.z));
}

// Vertex k's ring (0 the middle) and its place round it.
function ringOf(k: number): [number, number] {
  return k === 0 ? [0, 0] : [1 + Math.floor((k - 1) / SEGMENTS), (k - 1) % SEGMENTS];
}

function vertex(ring: number, segment: number): number {
  return 1 + (ring - 1) * SEGMENTS + (((segment % SEGMENTS) + SEGMENTS) % SEGMENTS);
}

function spot(k: number, x: number, z: number, radius: number): [number, number] {
  const [i, j] = ringOf(k);
  const r = (radius * i) / RINGS;
  const a = (2 * Math.PI * j) / SEGMENTS;
  return [x + Math.cos(a) * r, z + Math.sin(a) * r];
}

// The vertices joined to k: the next and last round its ring, and its fellows on the rings either side.
function neighbours(k: number): number[] {
  const [i, j] = ringOf(k);
  if (i === 0) return Array.from({ length: SEGMENTS }, (_, s) => vertex(1, s));
  const out = [vertex(i, j - 1), vertex(i, j + 1), i === 1 ? 0 : vertex(i - 1, j)];
  if (i < RINGS) out.push(vertex(i + 1, j));
  return out;
}
