// Meshes for the world's structures (sim/structures.ts), built once at load from the same list the
// sim collides with, so what you see is what you bump into. Each kind picks a builder in `build`;
// a new kind won't compile until it has one.
//
// Structures are unlit: a pixel texture (structureMaterials.ts) or a flat colour, shaded by which
// way each face points (tops bright, undersides dark) rather than by the scene's lights, so an
// interior reads the same as an exterior and a round wall doesn't band segment by segment. To keep
// the client light, pieces with the same look in the same REGION are merged into one mesh (a whole
// tower is a few draw calls, each culled when it's off screen), and none are pickable: the hover
// ray asks the sim's raycast instead.
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import {
  surfaceOf,
  type Box,
  type Ramp,
  type Structure,
  type StructureKind,
  type StructureMaterial,
  type Terrain,
} from '@world/shared';
import type { Engine } from './Engine';
import { MATERIALS, TEXELS, paintMaterial } from './structureMaterials';

const DEFAULT_COLORS: Record<StructureKind, string> = { box: '#39414f', ramp: '#454f60', terrain: '#1d3a2c' };
const REGION = 48; // metres: pieces in the same REGION × REGION square share a merged mesh
const FLAT_TILE = 4; // texture repeat for flat-coloured pieces, which have no texture to repeat
// Brightness by face direction, in each piece's own frame.
const SHADE = { top: 1, bottom: 0.5, sideX: 0.82, sideZ: 0.68 };

type Look = StructureMaterial | string; // a material, or a flat colour

export function buildStructures(engine: Engine, structures: readonly Structure[]): Mesh[] {
  const scene = engine.scene;
  const groups = new Map<string, { look: Look; meshes: Mesh[] }>();
  structures.forEach((s, i) => {
    const look: Look = s.material ?? s.color ?? DEFAULT_COLORS[s.kind];
    const spec = s.material ? MATERIALS[s.material] : null;
    const mesh = build(scene, `structure-${i}`, s, { tile: spec?.tile ?? FLAT_TILE, worldTop: spec?.worldTop ?? true });
    mesh.position.set(s.x, mesh.position.y + (s.y ?? 0), s.z);
    mesh.rotation.y = s.yaw ?? 0; // Babylon's rotation about y matches the sim's yaw
    const key = `${look}@${Math.floor(s.x / REGION)},${Math.floor(s.z / REGION)}`;
    const group = groups.get(key) ?? { look, meshes: [] };
    group.meshes.push(mesh);
    groups.set(key, group);
  });
  const materials = new Map<Look, StandardMaterial>();
  return [...groups].map(([key, { look, meshes }]) => {
    const merged = Mesh.MergeMeshes(meshes, true, true)!;
    merged.name = `structures-${key}`;
    let mat = materials.get(look);
    if (!mat) materials.set(look, (mat = material(scene, look)));
    merged.material = mat;
    merged.isPickable = false;
    merged.freezeWorldMatrix();
    return merged;
  });
}

function material(scene: Scene, look: Look): StandardMaterial {
  const mat = new StandardMaterial(`structure-mat-${look}`, scene);
  mat.disableLighting = true; // the colour is texture × face shade, exactly
  mat.specularColor = Color3.Black();
  if (look in MATERIALS) {
    // Nearest when magnified keeps the pixels crisp up close; trilinear and anisotropic when minified
    // stop distant and glancing walls shimmering.
    const tex = new DynamicTexture(`structure-tex-${look}`, TEXELS, scene, true, Texture.NEAREST_LINEAR_MIPLINEAR);
    tex.anisotropicFilteringLevel = 8;
    paintMaterial(tex.getContext() as CanvasRenderingContext2D, look as StructureMaterial);
    tex.update();
    tex.wrapU = tex.wrapV = Texture.WRAP_ADDRESSMODE;
    mat.diffuseTexture = tex;
    mat.emissiveColor = Color3.White();
  } else {
    mat.emissiveColor = Color3.FromHexString(look);
  }
  mat.freeze();
  return mat;
}

// How a piece's faces take their texture: metres per repeat, and whether tops tile in world x/z.
interface Mapping {
  tile: number;
  worldTop: boolean;
}

function build(scene: Scene, name: string, s: Structure, mapping: Mapping): Mesh {
  switch (s.kind) {
    case 'box':
    case 'ramp':
      return prism(scene, name, s, mapping);
    case 'terrain':
      return heightfield(scene, name, s, mapping);
  }
}

// A box over the footprint with each top corner dropped to the kind's surface height there:
// exact for any top that's flat or planar (boxes, ramps).
function prism(scene: Scene, name: string, s: Box | Ramp, mapping: Mapping): Mesh {
  const { top, height } = surfaceOf(s);
  const mesh = MeshBuilder.CreateBox(name, { width: s.w, height, depth: s.d, updatable: true }, scene);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] > 0) positions[i + 1] = top(positions[i], positions[i + 2]) - height / 2;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, mesh.getIndices(), normals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  paintFaces(mesh, s, positions, normals, height / 2, mapping);
  mesh.position.y = height / 2; // the box is centred; lift it so its underside is at local 0
  return mesh;
}

// A grid over the footprint, one vertex per height sample, flat-shaded into facets.
function heightfield(scene: Scene, name: string, s: Terrain, mapping: Mapping): Mesh {
  const { top } = surfaceOf(s);
  const mesh = MeshBuilder.CreateGround(
    name,
    {
      width: s.w,
      height: s.d,
      subdivisionsX: s.heights[0].length - 1,
      subdivisionsY: s.heights.length - 1,
      updatable: true,
    },
    scene,
  );
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) positions[i + 1] = top(positions[i], positions[i + 2]);
  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  mesh.convertToFlatShadedMesh();
  const flat = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  paintFaces(mesh, s, flat, mesh.getVerticesData(VertexBuffer.NormalKind)!, 0, { ...mapping, worldTop: true });
  return mesh;
}

// Texture coordinates in metres (one `tile` per repeat) and a vertex colour per face direction.
// Every coordinate is measured from the world origin, never from the piece, so two pieces of one
// look whose faces overlap in the same plane paint the same texel there and can't flicker: sides
// run along the face (the same way for every face pointing that way) and up world height, and tops
// use world x/z when `worldTop`, or else axes turned with the piece (a stair's planks run along
// each step), which match only between pieces turned the same way.
function paintFaces(
  mesh: Mesh,
  s: Structure,
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  lift: number,
  { tile, worldTop }: Mapping,
): void {
  const yaw = s.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const base = s.y ?? 0;
  const uvs: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const [lx, ly, lz] = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const [nx, ny, nz] = [normals[3 * i], normals[3 * i + 1], normals[3 * i + 2]];
    const wx = s.x + lx * cos + lz * sin;
    const wy = ly + lift + base;
    const wz = s.z - lx * sin + lz * cos;
    let shade: number;
    if (Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz)) {
      shade = ny > 0 ? SHADE.top : SHADE.bottom;
      if (worldTop) uvs.push(wx / tile, wz / tile);
      else uvs.push((wx * cos - wz * sin) / tile, (wx * sin + wz * cos) / tile);
    } else {
      shade = Math.abs(nx) >= Math.abs(nz) ? SHADE.sideX : SHADE.sideZ;
      // The face's normal in the world, turned a quarter about the vertical: along the face.
      const ax = -nx * sin + nz * cos;
      const az = -(nx * cos + nz * sin);
      const len = Math.hypot(ax, az);
      uvs.push((wx * ax + wz * az) / len / tile, wy / tile);
    }
    colors.push(shade, shade, shade, 1);
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}
