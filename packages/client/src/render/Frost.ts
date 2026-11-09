// The frost on the world's surfaces (sim/frost.ts), drawn as a crust over each frosted cell: a
// quad a hair off its face (frostQuad), translucent white with the faintest blue so the surface
// still shows through, pixel crystals flecked over it, a sheen that moves with the view as on
// anything shiny, and a few crystals twinkling. Cells are merged by REGION like the structures
// (render/Structures.ts), and a region's mesh is rebuilt the frame after any of its cells change,
// so a spray's spread costs a few small rebuilds a second. The shader does its own fog, the
// scene's, since a shader material gets none.
import { Effect, Mesh, ShaderMaterial, Vector3, VertexData } from '@babylonjs/core';
import { FLOOR, FROST_CELL, frostQuad, type FrostCell, type Structure } from '@world/shared';
import { FOG_COLOR, type Engine } from './Engine';

const REGION = 48; // metres: cells in the same REGION × REGION square share a mesh
const TEXELS_PER_METRE = 16; // crystals are drawn this fine, as the sand's grains are
// The sheen's light: where the scene's key light comes from (render/Engine.ts), as the frost sees it.
const LIGHT = new Vector3(0.4, 1, -0.6).normalize();

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vPos = position;
  vNormal = normal;
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// A glaze thicker in patches a few texels wide and mottled texel by texel, with a few crystals
// catching the light, half of them twinkling on their own clocks, and others glinting only from
// one angle, so they come and go as the eye moves. It's more opaque at a glancing view, as ice
// is, and brightest where the light reflects off it toward the eye.
const FRAGMENT = `
precision highp float;
uniform vec3 cameraPos;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float time;
uniform vec3 lightDir;
varying vec3 vPos;
varying vec3 vNormal;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 texel = floor(vUv * ${TEXELS_PER_METRE.toFixed(1)});
  float fine = hash(texel);
  float clump = hash(floor(texel / 3.0) + 0.5);
  float crust = 0.35 + 0.25 * clump + 0.15 * fine;
  float fleck = step(0.93, fine);
  float blink = fleck * step(0.5, hash(texel + floor(time * 2.0 + fine * 9.0) * 0.37));
  vec3 view = normalize(cameraPos - vPos);
  float glint = step(0.96, hash(texel + floor(dot(view, vec3(5.0, 9.0, 7.0)) * 40.0)));
  vec3 n = normalize(vNormal);
  if (dot(n, view) < 0.0) n = -n;
  float grazing = pow(1.0 - max(dot(n, view), 0.0), 2.0);
  float mirror = max(dot(reflect(-view, n), lightDir), 0.0);
  float sheen = pow(mirror, 20.0);
  float gloss = pow(mirror, 4.0);
  vec3 color = mix(vec3(0.92, 0.96, 1.0), vec3(1.0), fleck * 0.5 + blink * 0.5 + glint) + sheen * 0.4 + gloss * 0.15;
  float alpha =
    crust * 0.72 + 0.25 * fleck + 0.25 * blink + 0.3 * glint + 0.25 * grazing + 0.4 * sheen + 0.1 * gloss;
  float dist = length(cameraPos - vPos);
  float fog = exp(-dist * dist * fogDensity * fogDensity);
  gl_FragColor = vec4(mix(fogColor, color, fog), clamp(alpha, 0.0, 0.92));
}
`;

interface Region {
  cells: Map<string, FrostCell>;
  mesh: Mesh | null;
  dirty: boolean;
}

export class FrostLayer {
  private readonly regions = new Map<string, Region>();
  private readonly material: ShaderMaterial;
  private time = 0;

  constructor(
    private readonly engine: Engine,
    private readonly structures: readonly Structure[],
  ) {
    const scene = engine.scene;
    Effect.ShadersStore['frostVertexShader'] = VERTEX;
    Effect.ShadersStore['frostFragmentShader'] = FRAGMENT;
    this.material = new ShaderMaterial('frost', scene, 'frost', {
      attributes: ['position', 'normal', 'uv'],
      uniforms: ['worldViewProjection', 'cameraPos', 'fogColor', 'fogDensity', 'time', 'lightDir'],
      needAlphaBlending: true,
    });
    this.material.backFaceCulling = false;
    // Pulled toward the eye in depth: FROST_LIFT off a face is centimetres, and a far-off face's
    // depth, interpolated across a big triangle, wobbles by more than that, so a crust left at its
    // lift alone sinks into the floor in patches as the camera moves.
    this.material.zOffset = -2;
    this.material.zOffsetUnits = -2;
    this.material.setColor3('fogColor', FOG_COLOR);
    this.material.setVector3('lightDir', LIGHT);
  }

  // Freezes or melts one cell; its region is redrawn next frame.
  set(cell: FrostCell, on: boolean): void {
    const key = this.regionOf(cell);
    let region = this.regions.get(key);
    if (!region) this.regions.set(key, (region = { cells: new Map(), mesh: null, dirty: false }));
    const id = cell.join(':');
    if (on) region.cells.set(id, cell);
    else region.cells.delete(id);
    region.dirty = true;
  }

  update(dt: number, cameraPos: Vector3): void {
    this.time += dt;
    this.material.setFloat('time', this.time);
    this.material.setVector3('cameraPos', cameraPos);
    this.material.setFloat('fogDensity', this.engine.scene.fogDensity);
    for (const [key, region] of this.regions) if (region.dirty) this.rebuild(key, region);
  }

  private regionOf([piece, , i, j]: FrostCell): string {
    const s = piece === FLOOR ? null : this.structures[piece];
    const x = s ? s.x : i * FROST_CELL;
    const z = s ? s.z : j * FROST_CELL;
    return `${Math.floor(x / REGION)},${Math.floor(z / REGION)}`;
  }

  private rebuild(key: string, region: Region): void {
    region.dirty = false;
    region.mesh?.dispose();
    region.mesh = null;
    if (region.cells.size === 0) return;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (const [piece, face, i, j] of region.cells.values()) {
      const s = piece === FLOOR ? null : this.structures[piece];
      const quad = frostQuad(s, piece, face, i, j);
      if (!quad) continue;
      const base = positions.length / 3;
      // Each face's crystals are laid out from its own corner; a step between faces keeps two
      // that meet from sharing a pattern.
      const seedU = ((piece + 1) % 97) * 11;
      const seedV = face * 13;
      const [u0, v0, u1, v1] = quad.uv;
      const corners = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      quad.corners.forEach((c, k) => {
        positions.push(c.x, c.y, c.z);
        normals.push(quad.normal.x, quad.normal.y, quad.normal.z);
        uvs.push(corners[k][0] + seedU, corners[k][1] + seedV);
      });
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const mesh = new Mesh(`frost-${key}`, this.engine.scene);
    const data = new VertexData();
    data.positions = positions;
    data.normals = normals;
    data.uvs = uvs;
    data.indices = indices;
    data.applyToMesh(mesh);
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    region.mesh = mesh;
  }
}
