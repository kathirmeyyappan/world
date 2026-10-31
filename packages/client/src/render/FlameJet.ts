// A flamethrower's spray: a stream of glowing blocks that fly out along the parent's +z,
// spreading into a cone and cooling from yellow to red as they go; for a dragon's breath, many
// more of them inside a sheath of light that fills the cone. Cosmetic only; the server decides who
// burns. One instance per muzzle (viewmodel or avatar).
import {
  Color3,
  Constants,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
} from '@babylonjs/core';
import type { Engine } from './Engine';

const COUNT = 16; // blocks in a jet of BASE_LENGTH or shorter; longer ones get more
const FLIGHT_SECONDS = 0.35;
const BASE_LENGTH = 10; // metres a jet's blocks are sized for; longer jets grow them to fill the cone
const SHEATH_WIDTH = 0.8; // of the cone's, at its far end
const SHEATH_FLICKER = 0.08; // how much the sheath swells and shrinks

interface Particle {
  mesh: Mesh;
  mat: StandardMaterial;
  t: number; // 0 at the nozzle, 1 at full reach
  ox: number; // per-particle direction within the cone
  oy: number;
  spin: number;
}

export class FlameJet {
  private readonly particles: Particle[] = [];
  private readonly sheath: Mesh | null = null;
  private readonly growth: number; // how much a block grows on its way out, in metres
  private readonly spread: number; // how far out a block gets per metre along, at the cone's edge
  private on = false;
  private time = 0;

  // `length` and `halfAngle` are the item's cone (ItemSpec); `density` is how many times the usual
  // blocks it gets, and `sheath` whether the cone is filled with light.
  constructor(
    engine: Engine,
    name: string,
    parent: TransformNode,
    private readonly length: number,
    halfAngle: number,
    { density = 1, sheath = false }: { density?: number; sheath?: boolean } = {},
  ) {
    const scene = engine.scene;
    const stretch = Math.max(1, length / BASE_LENGTH);
    this.growth = 0.55 * stretch;
    this.spread = Math.tan(halfAngle);
    const count = Math.round(COUNT * stretch * density);
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateBox(`${name}-flame-${i}`, { size: 1 }, scene);
      const mat = new StandardMaterial(`${name}-flame-${i}-mat`, scene);
      mat.disableLighting = true;
      mat.alpha = 0.9;
      mesh.material = mat;
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.applyFog = false;
      mesh.setEnabled(false);
      engine.glowLayer.addIncludedOnlyMesh(mesh);
      this.particles.push({ mesh, mat, t: i / count, ox: 0, oy: 0, spin: 0 });
      this.scatter(this.particles[i]);
    }
    if (sheath) {
      // A cone from the nozzle out to most of the breath's width, its light fading along it.
      this.sheath = MeshBuilder.CreateCylinder(
        `${name}-sheath`,
        {
          height: length,
          diameterBottom: 0.6,
          diameterTop: 2 * length * this.spread * SHEATH_WIDTH,
          tessellation: 16,
          cap: Mesh.NO_CAP,
        },
        scene,
      );
      this.sheath.rotation.x = Math.PI / 2;
      this.sheath.position.z = length / 2;
      this.sheath.parent = parent;
      this.sheath.material = sheathMaterial(engine, `${name}-sheath`);
      this.sheath.isPickable = false;
      this.sheath.applyFog = false;
      this.sheath.setEnabled(false);
    }
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const p of this.particles) p.mesh.setEnabled(on);
    this.sheath?.setEnabled(on);
  }

  update(dt: number): void {
    if (!this.on) return;
    this.time += dt;
    for (const p of this.particles) {
      p.t += dt / FLIGHT_SECONDS;
      if (p.t >= 1) {
        p.t -= 1;
        this.scatter(p);
      }
      const d = p.t * this.length;
      p.mesh.position.set(p.ox * d * this.spread, p.oy * d * this.spread, d);
      const size = 0.12 + p.t * this.growth;
      p.mesh.scaling.setAll(size);
      p.mesh.rotation.set(p.spin * p.t * 6, p.spin * p.t * 4, p.t * 3);
      // yellow at the nozzle, orange in the middle, dark red and fading at the end
      const heat = 1 - p.t;
      p.mat.emissiveColor = new Color3(1, 0.25 + 0.65 * heat, 0.05 + 0.3 * heat * heat);
      p.mat.alpha = 0.95 * Math.min(1, 1.6 - p.t * 1.6);
    }
    if (this.sheath) {
      const t = this.time;
      this.sheath.scaling.set(
        1 + SHEATH_FLICKER * Math.sin(t * 23),
        1 + SHEATH_FLICKER * Math.cos(t * 17),
        1 + SHEATH_FLICKER * Math.sin(t * 11),
      );
    }
  }

  dispose(): void {
    for (const p of this.particles) {
      p.mesh.dispose();
      p.mat.dispose();
    }
    this.sheath?.dispose();
  }

  private scatter(p: Particle): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random());
    p.ox = Math.cos(a) * r;
    p.oy = Math.sin(a) * r;
    p.spin = Math.random() * 2 - 1;
  }
}

// Fire's light, added over whatever is behind it: white-hot at the nozzle, orange along the way,
// and gone by the cone's end. Drawn once and shared.
let sheathTexture: DynamicTexture | null = null;
function sheathMaterial(engine: Engine, name: string): StandardMaterial {
  const scene = engine.scene;
  if (!sheathTexture) {
    const w = 4;
    const h = 64;
    sheathTexture = new DynamicTexture(
      'flame-sheath',
      { width: w, height: h },
      scene,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    sheathTexture.hasAlpha = true;
    const ctx = sheathTexture.getContext() as CanvasRenderingContext2D;
    const g = ctx.createLinearGradient(0, h, 0, 0); // v runs up the cylinder: the nozzle end is at the bottom of the image
    g.addColorStop(0, 'rgba(255,245,200,0.75)');
    g.addColorStop(0.3, 'rgba(255,170,60,0.5)');
    g.addColorStop(0.7, 'rgba(255,90,30,0.25)');
    g.addColorStop(1, 'rgba(200,40,20,0)');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    sheathTexture.update();
  }
  const m = new StandardMaterial(name, scene);
  m.emissiveTexture = sheathTexture;
  m.opacityTexture = sheathTexture;
  m.diffuseColor = Color3.Black();
  m.disableLighting = true;
  m.backFaceCulling = false;
  m.alphaMode = Constants.ALPHA_ADD; // light over what's behind, never darkening it
  return m;
}
