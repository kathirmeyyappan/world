// Static scenery: shader-drawn grid floor, a kerb along the world's edge with the ground past it
// OUTSIDE_HEIGHT below, gradient sky with stars, and a boundary wall that only shows up when you
// get close, at whatever height you're at. All of it follows the world shape. Sky billboards live in
// SkyObject.ts.
import { Color3, Effect, Mesh, MeshBuilder, ShaderMaterial, Vector3, VertexData } from '@babylonjs/core';
import { EYE_HEIGHT, OUTSIDE_HEIGHT, partDistance, worldBounds, type WorldPart, worldReach } from '@world/shared';
import { BASE_FOG_DENSITY, Engine, FOG_COLOR } from './Engine';
import {
  GROUND_FOG,
  GROUND_FRAGMENT,
  GROUND_VERTEX,
  MAX_SECTORS,
  MAX_BRIDGES,
  MAX_DISCS,
  KERB_HEIGHT,
  KERB_WIDTH,
  SKY_FRAGMENT,
  SKY_VERTEX,
  STEP_GAP,
  WALL_FRAGMENT,
  WALL_VERTEX,
} from './shaders';

const WALL_REVEAL_DISTANCE = 16;
const WALL_ABOVE = 16; // the boundary reaches this far above the tallest structure (or the floor)
const SKY_WALL_TOP = 500; // metres: the sky's edge reaches as high as a dragon is likely to fly
const WALL_STEP = 0.8; // metres between ribbon samples along the outline

const FOG_HALF_LIFE = 0.12; // seconds, for the scope's fog change
const ZENITH_COLOR = new Color3(0.01, 0.01, 0.04);
const HORIZON_COLOR = new Color3(0.12, 0.03, 0.14);
const FADED = Math.log(10); // the floor's fog exponent at 90% fogged: where the horizon sits

type Point = { x: number; z: number };

export class Environment {
  private readonly materials: ShaderMaterial[] = [];
  private readonly grounds: ShaderMaterial[] = []; // the floor's, the ground's past the edge and the kerb's
  private sky!: ShaderMaterial; // set in createSky
  private fogScale = 1;
  private fogTarget = 1;
  private readonly bounds;
  private readonly span: number;
  private time = 0;
  private groundWall!: Mesh; // the outline a walker is kept inside, set in createWalls
  private skyWall!: Mesh; // the circle round all of it a dragon is kept inside

  constructor(
    private readonly engine: Engine,
    private readonly shape: WorldPart[],
    private readonly ceiling = 0, // the top of the tallest structure
  ) {
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
    this.createWalls();
  }

  // Shows the boundary that applies to the viewer's class: the world's outline on foot, the circle
  // of its reach as a dragon.
  setBounds(bounds: 'ground' | 'sky'): void {
    this.groundWall.setEnabled(bounds === 'ground');
    this.skyWall.setEnabled(bounds === 'sky');
  }

  // The floor inside the world's edge, the ground past it, and the kerb along it: one shader, the
  // floor and the ground each drawn only on its own side of the kerb's middle, so both end under it
  // and every edge in sight is the kerb's own.
  private createGround(): void {
    const scene = this.engine.scene;
    const size = this.span * 6;
    const plane = (name: string, y: number, side: number) => {
      // In tiles: one triangle across the whole world interpolates depth coarsely far off, and the
      // crusts and sills laid a hair over the floor sink into it.
      const mesh = MeshBuilder.CreateGround(name, { width: size, height: size, subdivisions: 16 }, scene);
      mesh.position.set((this.bounds.minX + this.bounds.maxX) / 2, y, (this.bounds.minZ + this.bounds.maxZ) / 2);
      mesh.isPickable = false;
      mesh.material = this.groundMaterial(name, side);
    };
    plane('ground', 0, 0);
    plane('outside-ground', OUTSIDE_HEIGHT, 1);
    this.createKerb(this.groundMaterial('kerb', 2));
  }

  // A bold kerb along the world's edge: KERB_WIDTH across inside it and KERB_HEIGHT up, its outer
  // face (STEP_GAP out, off the boundary wall's plane) going on down to the ground past the edge,
  // with a toe as bold along its foot, KERB_WIDTH out over that ground and KERB_HEIGHT up from it.
  private createKerb(mat: ShaderMaterial): void {
    const positions: number[] = [];
    const indices: number[] = [];
    const foot = OUTSIDE_HEIGHT + KERB_HEIGHT;
    // The kerb along `points`, each with the way out square to the edge there.
    const strip = (points: { p: Point; n: Point }[]) => {
      const base = positions.length / 3;
      for (const { p, n } of points) {
        const at = (d: number) => [p.x + n.x * d, p.z + n.z * d];
        const [ix, iz] = at(-KERB_WIDTH);
        const [ox, oz] = at(STEP_GAP);
        const [tx, tz] = at(STEP_GAP + KERB_WIDTH);
        positions.push(
          ix,
          0,
          iz,
          ix,
          KERB_HEIGHT,
          iz,
          ox,
          KERB_HEIGHT,
          oz,
          ox,
          foot,
          oz,
          tx,
          foot,
          tz,
          tx,
          OUTSIDE_HEIGHT,
          tz,
        );
      }
      for (let i = 0; i < points.length - 1; i++) {
        const a = base + i * KERB_RING;
        for (let band = 0; band < KERB_RING - 1; band++) {
          const [p, q] = [a + band, a + KERB_RING + band];
          indices.push(p, p + 1, q, p + 1, q + 1, q);
        }
      }
    };
    const runs = this.exposedRuns(this.shape);
    for (const { part, points } of runs) strip(points.map((p) => ({ p, n: outward(part, p) })));
    for (const corner of roundJoins(runs)) strip(corner);
    const kerb = new Mesh('kerb', this.engine.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.applyToMesh(kerb);
    kerb.isPickable = false;
    kerb.material = mat;
  }

  private groundMaterial(name: string, side: number): ShaderMaterial {
    const mat = new ShaderMaterial(`${name}Mat`, this.engine.scene, 'worldGround', {
      attributes: ['position'],
      uniforms: [
        'world',
        'worldViewProjection',
        'cameraPos',
        'side',
        'lineColor',
        'majorColor',
        'floorColor',
        'fogColor',
        'fogScale',
        'time',
        'zenithColor',
        'horizonColor',
        'horizon',
        'discs',
        'bridges',
        'bridgeWidths',
        'sectors',
        'sectorSpans',
        'discCount',
        'bridgeCount',
        'sectorCount',
      ],
    });
    mat.setFloat('side', side);
    mat.setColor3('lineColor', new Color3(0.2, 0.9, 0.5));
    mat.setColor3('majorColor', new Color3(0.45, 1.0, 0.7));
    mat.setColor3('floorColor', new Color3(0.03, 0.06, 0.05));
    mat.setColor3('fogColor', FOG_COLOR);
    mat.setFloat('fogScale', 1);
    mat.setColor3('zenithColor', ZENITH_COLOR);
    mat.setColor3('horizonColor', HORIZON_COLOR);
    mat.setFloat('horizon', 0);
    this.setShapeUniforms(mat);
    mat.backFaceCulling = false;
    this.grounds.push(mat);
    this.materials.push(mat);
    return mat;
  }

  private setShapeUniforms(mat: ShaderMaterial): void {
    const discs: number[] = [];
    const bridges: number[] = [];
    const widths: number[] = [];
    const sectors: number[] = [];
    const spans: number[] = [];
    for (const part of this.shape) {
      if (part.kind === 'disc') discs.push(part.x, part.z, part.r);
      else if (part.kind === 'bridge') {
        bridges.push(part.ax, part.az, part.bx, part.bz);
        widths.push(part.halfWidth);
      } else {
        sectors.push(part.x, part.z, part.r);
        spans.push(part.from, part.to);
      }
    }
    const discCount = discs.length / 3;
    const bridgeCount = widths.length;
    const sectorCount = sectors.length / 3;
    if (discCount > MAX_DISCS || bridgeCount > MAX_BRIDGES || sectorCount > MAX_SECTORS)
      throw new Error(
        `the world has more discs, bridges or sectors than the floor shader's ${MAX_DISCS}, ${MAX_BRIDGES} and ${MAX_SECTORS}`,
      );
    while (discs.length < MAX_DISCS * 3) discs.push(0, 0, 0);
    while (bridges.length < MAX_BRIDGES * 4) bridges.push(0, 0, 0, 0);
    while (widths.length < MAX_BRIDGES) widths.push(0);
    while (sectors.length < MAX_SECTORS * 3) sectors.push(0, 0, 0);
    while (spans.length < MAX_SECTORS * 2) spans.push(0, 0);
    mat.setArray3('discs', discs);
    mat.setArray4('bridges', bridges);
    mat.setFloats('bridgeWidths', widths);
    mat.setArray3('sectors', sectors);
    mat.setArray2('sectorSpans', spans);
    mat.setInt('discCount', discCount);
    mat.setInt('bridgeCount', bridgeCount);
    mat.setInt('sectorCount', sectorCount);
  }

  private createSky(): void {
    const scene = this.engine.scene;
    const sky = MeshBuilder.CreateSphere(
      'sky',
      { diameter: this.span * 15, segments: 16, sideOrientation: Mesh.BACKSIDE },
      scene,
    );
    sky.isPickable = false;
    sky.infiniteDistance = true;
    sky.applyFog = false;
    const mat = new ShaderMaterial('skyMat', scene, 'worldSky', {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'fogColor', 'zenithColor', 'horizonColor', 'horizon', 'time'],
    });
    mat.setColor3('fogColor', FOG_COLOR);
    mat.setColor3('zenithColor', ZENITH_COLOR);
    mat.setColor3('horizonColor', HORIZON_COLOR);
    mat.setFloat('horizon', 0);
    this.sky = mat;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    sky.material = mat;
    this.materials.push(mat);
  }

  // The two boundaries, one shown at a time (setBounds), on one material.
  private createWalls(): void {
    const scene = this.engine.scene;
    const mat = new ShaderMaterial('wallMat', scene, 'worldWall', {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'worldViewProjection', 'cameraPos', 'wallColor', 'revealDistance', 'time'],
      needAlphaBlending: true,
    });
    mat.setColor3('wallColor', new Color3(1.0, 0.25, 0.35));
    mat.setFloat('revealDistance', WALL_REVEAL_DISTANCE);
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    this.materials.push(mat);
    this.groundWall = this.createWall('wall', this.shape, this.ceiling + WALL_ABOVE, mat);
    this.skyWall = this.createWall(
      'sky-wall',
      [{ kind: 'disc', x: 0, z: 0, r: worldReach(this.shape) }],
      SKY_WALL_TOP,
      mat,
    );
    this.skyWall.setEnabled(false);
  }

  // A vertical ribbon along a shape's outline, `top` metres tall.
  private createWall(name: string, shape: WorldPart[], top: number, mat: ShaderMaterial): Mesh {
    const scene = this.engine.scene;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let arc = 0;

    for (const { points: run } of this.exposedRuns(shape)) {
      const base = positions.length / 3;
      for (let i = 0; i < run.length; i++) {
        if (i > 0) arc += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
        positions.push(run[i].x, 0, run[i].z, run[i].x, top, run[i].z);
        uvs.push(arc, 0, arc, 1);
      }
      for (let i = 0; i < run.length - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      arc += 3; // gap so the pattern doesn't line up across a join
    }

    const wall = new Mesh(name, scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = uvs;
    data.applyToMesh(wall);
    wall.isPickable = false;
    wall.material = mat;
    return wall;
  }

  // The stretches of a shape's outline that are its edge: each part's edge sampled, the samples that
  // fall inside another part dropped (that's where parts join), and each run carried on to the exact
  // point where its edge goes into the other part, so two parts' stretches meet in the corner
  // between them.
  private exposedRuns(shape: WorldPart[]): { part: WorldPart; points: Point[] }[] {
    const runs: { part: WorldPart; points: Point[] }[] = [];
    for (const part of shape) {
      const exposed = (p: Point) => shape.every((other) => other === part || partDistance(p.x, p.z, other) > 0);
      let run: Point[] = [];
      const end = () => {
        if (run.length >= 2) runs.push({ part, points: run });
        run = [];
      };
      let last: { p: Point; out: boolean } | null = null;
      for (const p of this.outline(part)) {
        if (!p) {
          end();
          last = null;
          continue;
        }
        const out = exposed(p);
        if (last && out !== last.out) run.push(crossing(last.p, p, exposed));
        if (out) run.push(p);
        else end();
        last = { p, out };
      }
      end();
    }
    return runs;
  }

  // Points along one part's own edge, in order: a closed loop for discs and sectors, two sides for
  // bridges with a null between them so they're never stitched together.
  private *outline(part: WorldPart): Iterable<Point | null> {
    if (part.kind === 'disc') {
      const steps = Math.max(24, Math.ceil((2 * Math.PI * part.r) / WALL_STEP));
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        yield { x: part.x + Math.cos(a) * part.r, z: part.z + Math.sin(a) * part.r };
      }
      return;
    }
    if (part.kind === 'sector') {
      const middle = { x: part.x, z: part.z };
      const point = (a: number, r: number) => ({ x: part.x + Math.cos(a) * r, z: part.z + Math.sin(a) * r });
      const side = Math.max(2, Math.ceil(part.r / WALL_STEP));
      for (let i = 0; i < side; i++) yield point(part.from, (part.r * i) / side);
      const steps = Math.max(2, Math.ceil(((part.to - part.from) * part.r) / WALL_STEP));
      for (let i = 0; i <= steps; i++) yield point(part.from + ((part.to - part.from) * i) / steps, part.r);
      for (let i = side - 1; i > 0; i--) yield point(part.to, (part.r * i) / side);
      yield middle;
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

  // How far you can see, as a multiplier on the squared fog term: 1 is the normal murk, a small
  // number thins it so a scope can pick out a player at its full range. Eased in update().
  setVisibility(fogScale: number): void {
    this.fogTarget = fogScale;
  }

  // Once per frame: the shaders need the camera position for fades, a clock for pulses, and the
  // horizon: where the floor fades out, which is at eye level on the floor and well below it up high.
  update(dt: number, cameraPos: Vector3): void {
    this.time += dt;
    if (this.fogScale !== this.fogTarget) {
      const k = 1 - Math.pow(0.5, dt / FOG_HALF_LIFE);
      this.fogScale += (this.fogTarget - this.fogScale) * k;
      if (Math.abs(this.fogScale - this.fogTarget) < 1e-3) this.fogScale = this.fogTarget;
      for (const g of this.grounds) g.setFloat('fogScale', this.fogScale);
      this.engine.scene.fogDensity = BASE_FOG_DENSITY * Math.sqrt(this.fogScale);
    }
    for (const m of this.materials) {
      m.setFloat('time', this.time);
      m.setVector3('cameraPos', cameraPos);
    }
    const height = Math.max(0, cameraPos.y - EYE_HEIGHT);
    const faded = Math.sqrt(FADED / (GROUND_FOG * this.fogScale)); // metres to where the floor is 90% fog
    const horizon = -height / Math.hypot(height, faded); // the sine of the angle down to it
    this.sky.setFloat('horizon', horizon);
    for (const g of this.grounds) g.setFloat('horizon', horizon);
  }
}

const KERB_RING = 6; // vertices across the kerb at each point along it: its inner face, top, drop and toe

const JOIN_STEP = Math.PI / 18; // radians between the kerb's normals round a corner

// Where two runs of the edge meet (a corner between two parts, both runs ending on the very point
// their edges cross), the kerb swept round that point from one run's way out to the other's, the
// short way: a round join, closing the corner whichever way the edge bends there.
function roundJoins(runs: { part: WorldPart; points: Point[] }[]): { p: Point; n: Point }[][] {
  const ends = runs.flatMap(({ part, points }) =>
    [points[0], points[points.length - 1]].map((p) => ({ p, n: outward(part, p) })),
  );
  const joins: { p: Point; n: Point }[][] = [];
  ends.forEach((a, i) =>
    ends.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z) > 0.01) return;
      const from = Math.atan2(a.n.z, a.n.x);
      const turn = Math.atan2(a.n.x * b.n.z - a.n.z * b.n.x, a.n.x * b.n.x + a.n.z * b.n.z);
      if (Math.abs(turn) < 1e-3) return; // a loop closing on itself, or edges meeting straight on
      const steps = Math.ceil(Math.abs(turn) / JOIN_STEP);
      joins.push(
        Array.from({ length: steps + 1 }, (_, k) => {
          const angle = from + (turn * k) / steps;
          return { p: a.p, n: { x: Math.cos(angle), z: Math.sin(angle) } };
        }),
      );
    }),
  );
  return joins;
}

// The way out of `part` square to its edge at `p`, a unit vector.
function outward(part: WorldPart, p: Point): Point {
  const e = 0.01;
  const dx = partDistance(p.x + e, p.z, part) - partDistance(p.x - e, p.z, part);
  const dz = partDistance(p.x, p.z + e, part) - partDistance(p.x, p.z - e, part);
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

// The point between `a` and `b` where `test` changes its answer, to well under a millimetre.
function crossing(a: Point, b: Point, test: (p: Point) => boolean): Point {
  const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  const start = test(a);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (test(at(mid)) === start) lo = mid;
    else hi = mid;
  }
  return at((lo + hi) / 2);
}
