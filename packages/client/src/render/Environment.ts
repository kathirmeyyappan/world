// Static scenery: shader-drawn grid floor, gradient sky with stars, and a boundary wall that only
// shows up when you get close. All of it follows the world shape. Sky billboards live in
// SkyObject.ts.
import { Color3, Effect, Mesh, MeshBuilder, ShaderMaterial, Vector3, VertexData } from '@babylonjs/core';
import { partDistance, worldBounds, type WorldPart } from '@world/shared';
import { Engine, FOG_COLOR } from './Engine';
import {
  GROUND_FRAGMENT, GROUND_VERTEX, MAX_BRIDGES, MAX_DISCS, SKY_FRAGMENT, SKY_VERTEX, WALL_FRAGMENT, WALL_VERTEX,
} from './shaders';

const WALL_REVEAL_DISTANCE = 16;
const WALL_HEIGHT = 16;
const WALL_STEP = 0.8; // metres between ribbon samples along the outline

export class Environment {
  private readonly materials: ShaderMaterial[] = [];
  private readonly bounds;
  private readonly span: number;
  private time = 0;

  constructor(private readonly engine: Engine, private readonly shape: WorldPart[]) {
    this.bounds = worldBounds(shape);
    this.span = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxZ - this.bounds.minZ);
    Effect.ShadersStore['worldGroundVertexShader'] = GROUND_VERTEX;
    Effect.ShadersStore['worldGroundFragmentShader'] = GROUND_FRAGMENT;
    Effect.ShadersStore['worldSkyVertexShader'] = SKY_VERTEX;
    Effect.ShadersStore['worldSkyFragmentShader'] = SKY_FRAGMENT;
    Effect.ShadersStore['worldWallVertexShader'] = WALL_VERTEX;
    Effect.ShadersStore['worldWallFragmentShader'] = WALL_FRAGMENT;
    this.createGround();
    this.createSky();
    this.createWall();
  }

  private createGround(): void {
    const scene = this.engine.scene;
    const size = this.span * 6;
    const ground = MeshBuilder.CreateGround('ground', { width: size, height: size, subdivisions: 1 }, scene);
    ground.position.set((this.bounds.minX + this.bounds.maxX) / 2, 0, (this.bounds.minZ + this.bounds.maxZ) / 2);
    ground.isPickable = false;
    const mat = new ShaderMaterial('groundMat', scene, 'worldGround', {
      attributes: ['position'],
      uniforms: [
        'world', 'worldViewProjection', 'cameraPos', 'lineColor', 'majorColor', 'floorColor', 'fogColor', 'time',
        'discs', 'bridges', 'bridgeWidths', 'discCount', 'bridgeCount',
      ],
    });
    mat.setColor3('lineColor', new Color3(0.2, 0.9, 0.5));
    mat.setColor3('majorColor', new Color3(0.45, 1.0, 0.7));
    mat.setColor3('floorColor', new Color3(0.03, 0.06, 0.05));
    mat.setColor3('fogColor', FOG_COLOR);
    this.setShapeUniforms(mat);
    mat.backFaceCulling = false;
    ground.material = mat;
    this.materials.push(mat);
  }

  private setShapeUniforms(mat: ShaderMaterial): void {
    const discs: number[] = [];
    const bridges: number[] = [];
    const widths: number[] = [];
    for (const part of this.shape) {
      if (part.kind === 'disc') discs.push(part.x, part.z, part.r);
      else {
        bridges.push(part.ax, part.az, part.bx, part.bz);
        widths.push(part.halfWidth);
      }
    }
    const discCount = Math.min(discs.length / 3, MAX_DISCS);
    const bridgeCount = Math.min(widths.length, MAX_BRIDGES);
    if (discs.length / 3 > MAX_DISCS || widths.length > MAX_BRIDGES) console.warn('world shape exceeds shader limits; floor will be wrong');
    while (discs.length < MAX_DISCS * 3) discs.push(0, 0, 0);
    while (bridges.length < MAX_BRIDGES * 4) bridges.push(0, 0, 0, 0);
    while (widths.length < MAX_BRIDGES) widths.push(0);
    mat.setArray3('discs', discs);
    mat.setArray4('bridges', bridges);
    mat.setFloats('bridgeWidths', widths);
    mat.setInt('discCount', discCount);
    mat.setInt('bridgeCount', bridgeCount);
  }

  private createSky(): void {
    const scene = this.engine.scene;
    const sky = MeshBuilder.CreateSphere('sky', { diameter: this.span * 15, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    const mat = new ShaderMaterial('skyMat', scene, 'worldSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'fogColor', 'zenithColor', 'horizonColor', 'time'],
    });
    mat.setColor3('fogColor', FOG_COLOR);
    mat.setColor3('zenithColor', new Color3(0.01, 0.01, 0.04));
    mat.setColor3('horizonColor', new Color3(0.12, 0.03, 0.14));
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    sky.material = mat;
    this.materials.push(mat);
  }

  // A vertical ribbon along the union's outline. Each part's edge is sampled, samples that fall
  // inside another part are dropped (that's where parts join), and the survivors become quads.
  private createWall(): void {
    const scene = this.engine.scene;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let arc = 0;

    const pushRun = (run: { x: number; z: number }[]) => {
      if (run.length < 2) return;
      const base = positions.length / 3;
      for (let i = 0; i < run.length; i++) {
        if (i > 0) arc += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
        positions.push(run[i].x, 0, run[i].z, run[i].x, WALL_HEIGHT, run[i].z);
        uvs.push(arc, 0, arc, 1);
      }
      for (let i = 0; i < run.length - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      arc += 3; // gap so the pattern doesn't line up across a join
    };

    for (const part of this.shape) {
      let run: { x: number; z: number }[] = [];
      for (const p of this.outline(part)) {
        const exposed = p && this.shape.every((other) => other === part || partDistance(p.x, p.z, other) > -0.05);
        if (exposed) run.push(p);
        else {
          pushRun(run);
          run = [];
        }
      }
      pushRun(run);
    }

    const wall = new Mesh('wall', scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = uvs;
    data.applyToMesh(wall);
    wall.isPickable = false;
    const mat = new ShaderMaterial('wallMat', scene, 'worldWall', {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'worldViewProjection', 'cameraPos', 'wallColor', 'revealDistance', 'time'],
      needAlphaBlending: true,
    });
    mat.setColor3('wallColor', new Color3(1.0, 0.25, 0.35));
    mat.setFloat('revealDistance', WALL_REVEAL_DISTANCE);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    wall.material = mat;
    this.materials.push(mat);
  }

  // Points along one part's own edge, in order: a closed loop for discs, two sides for bridges
  // with a null between them so they're never stitched together.
  private *outline(part: WorldPart): Iterable<{ x: number; z: number } | null> {
    if (part.kind === 'disc') {
      const steps = Math.max(24, Math.ceil((2 * Math.PI * part.r) / WALL_STEP));
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        yield { x: part.x + Math.cos(a) * part.r, z: part.z + Math.sin(a) * part.r };
      }
      return;
    }
    const len = Math.hypot(part.bx - part.ax, part.bz - part.az);
    const nx = -(part.bz - part.az) / len;
    const nz = (part.bx - part.ax) / len;
    const steps = Math.max(2, Math.ceil(len / WALL_STEP));
    for (const side of [1, -1]) {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        yield {
          x: part.ax + (part.bx - part.ax) * t + nx * part.halfWidth * side,
          z: part.az + (part.bz - part.az) * t + nz * part.halfWidth * side,
        };
      }
      yield null;
    }
  }

  // Once per frame: the shaders need the camera position for fades and a clock for pulses.
  update(dt: number, cameraPos: Vector3): void {
    this.time += dt;
    for (const m of this.materials) {
      m.setFloat('time', this.time);
      m.setVector3('cameraPos', cameraPos);
    }
  }
}
