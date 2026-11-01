// A flamethrower's spray: a stream of glowing blocks that fly out along the parent's +z,
// spreading into a cone and cooling from yellow to red as they go; a dragon's breath is the same
// with many more blocks, bigger, and crowded toward the middle of the cone. Cosmetic only; the
// server decides who burns. One instance per muzzle (viewmodel or avatar).
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Engine } from './Engine';

const COUNT = 16; // blocks in a jet of BASE_LENGTH or shorter; longer ones get more
const FLIGHT_SECONDS = 0.35;
const BASE_LENGTH = 10; // metres a jet's blocks are sized for; longer jets grow them to fill the cone

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
  private readonly growth: number; // how much a block grows on its way out, in metres
  private readonly start: number; // how big a block leaves the nozzle, in metres
  private readonly spread: number; // how far out a block gets per metre along, at the cone's edge
  private readonly core: number; // how the blocks crowd the middle: 1 spreads them evenly, more bunches them
  private on = false;

  // `length` and `halfAngle` are the item's cone (ItemSpec); `density` is how many times the usual
  // blocks it gets, `size` how many times their usual size, and `core` how much they keep to the
  // middle of the cone.
  constructor(
    engine: Engine,
    name: string,
    parent: TransformNode,
    private readonly length: number,
    halfAngle: number,
    { density = 1, size = 1, core = 1 }: { density?: number; size?: number; core?: number } = {},
  ) {
    const scene = engine.scene;
    const stretch = Math.max(1, length / BASE_LENGTH);
    this.growth = 0.55 * stretch * size;
    this.start = 0.12 * size;
    this.spread = Math.tan(halfAngle);
    this.core = core;
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
  }

  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const p of this.particles) p.mesh.setEnabled(on);
  }

  update(dt: number): void {
    if (!this.on) return;
    for (const p of this.particles) {
      p.t += dt / FLIGHT_SECONDS;
      if (p.t >= 1) {
        p.t -= 1;
        this.scatter(p);
      }
      const d = p.t * this.length;
      p.mesh.position.set(p.ox * d * this.spread, p.oy * d * this.spread, d);
      const size = this.start + p.t * this.growth;
      p.mesh.scaling.setAll(size);
      p.mesh.rotation.set(p.spin * p.t * 6, p.spin * p.t * 4, p.t * 3);
      // yellow at the nozzle, orange in the middle, dark red and fading at the end
      const heat = 1 - p.t;
      p.mat.emissiveColor = new Color3(1, 0.25 + 0.65 * heat, 0.05 + 0.3 * heat * heat);
      p.mat.alpha = 0.95 * Math.min(1, 1.6 - p.t * 1.6);
    }
  }

  dispose(): void {
    for (const p of this.particles) {
      p.mesh.dispose();
      p.mat.dispose();
    }
  }

  private scatter(p: Particle): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), this.core / 2);
    p.ox = Math.cos(a) * r;
    p.oy = Math.sin(a) * r;
    p.spin = Math.random() * 2 - 1;
  }
}
