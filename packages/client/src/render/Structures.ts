// Meshes for the world's structures (sim/structures.ts), built once at load from the same list the
// sim collides with, so what you see is what you bump into. Each kind picks a builder in `build`;
// a new kind won't compile until it has one. Meshes are named `structure-<i>` so the hover ray
// can tell that a wall is in the way.
import {
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import { surfaceOf, type Box, type Ramp, type Structure, type StructureKind, type Terrain } from '@world/shared';
import type { Engine } from './Engine';

const DEFAULT_COLORS: Record<StructureKind, string> = { box: '#39414f', ramp: '#454f60', terrain: '#1d3a2c' };
const EDGE_COLOR = new Color4(0.39, 0.71, 0.96, 0.9); // the HUD accent, so solid edges read at night

export function buildStructures(engine: Engine, structures: readonly Structure[]): Mesh[] {
  const materials = new Map<string, StandardMaterial>();
  const material = (color: string) => {
    let mat = materials.get(color);
    if (!mat) {
      mat = new StandardMaterial(`structure-mat-${color}`, engine.scene);
      mat.diffuseColor = Color3.FromHexString(color);
      mat.emissiveColor = mat.diffuseColor.scale(0.15);
      mat.specularColor = Color3.Black();
      mat.freeze();
      materials.set(color, mat);
    }
    return mat;
  };
  return structures.map((s, i) => {
    const mesh = build(engine.scene, `structure-${i}`, s);
    mesh.material = material(s.color ?? DEFAULT_COLORS[s.kind]);
    mesh.position.set(s.x, mesh.position.y + (s.y ?? 0), s.z);
    mesh.rotation.y = s.yaw ?? 0; // Babylon's rotation about y matches the sim's yaw
    mesh.freezeWorldMatrix();
    return mesh;
  });
}

function build(scene: Scene, name: string, s: Structure): Mesh {
  switch (s.kind) {
    case 'box':
    case 'ramp':
      return prism(scene, name, s);
    case 'terrain':
      return heightfield(scene, name, s);
  }
}

// A box over the footprint with each top corner dropped to the kind's surface height there:
// exact for any top that's flat or planar (boxes, ramps). Outlined, for the retro edges.
function prism(scene: Scene, name: string, s: Box | Ramp): Mesh {
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
  mesh.position.y = height / 2; // the box is centred; lift it so its underside is at local 0
  mesh.enableEdgesRendering();
  mesh.edgesWidth = 2;
  mesh.edgesColor = EDGE_COLOR;
  return mesh;
}

// A grid over the footprint, one vertex per height sample, flat-shaded into facets.
function heightfield(scene: Scene, name: string, s: Terrain): Mesh {
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
  return mesh;
}
