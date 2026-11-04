// Landmarks drawn from mesh files rather than built from structures: the pineapple house, in the
// parts scripts/house-model.py writes (render/models/pineappleParts.ts), fetched through the
// loader (render/Loader.ts) and stood where the shared content puts it (content/pineapple.ts). The
// sim never sees these meshes; it collides with the structures the content hides inside them, so
// what you bump into is theirs to keep true to the models. Each door hangs on a node at its pin and
// swings to the state the Room tells us (sim/doors.ts) over DOOR_SWING_SECONDS.
import { Color3, Mesh, StandardMaterial, Texture, TransformNode, VertexData, type Scene } from '@babylonjs/core';
import { DOOR_SWING_SECONDS, PINEAPPLE_PLACEMENT, PINEAPPLE_PROFILE } from '@world/shared';
import type { Engine } from '../Engine';
import type { Loader } from '../Loader';
import { PINEAPPLE_PARTS, type PineapplePart } from './pineappleParts';

const GLOW = 0.3; // how much a model lights itself, like the avatars, so it reads at night
const UV_UNIT = 4096; // texture coordinate units to the repeat in the mesh files

export class Models {
  private readonly doors = new Map<string, { node: TransformNode; swing: number; open: boolean; at: number }>();

  constructor(engine: Engine, loader: Loader) {
    const scene = engine.scene;
    const house = new TransformNode('model-pineapple', scene);
    house.position.set(PINEAPPLE_PLACEMENT.x, PINEAPPLE_PLACEMENT.y, PINEAPPLE_PLACEMENT.z);
    house.rotation.y = PINEAPPLE_PLACEMENT.yaw;
    for (const door of PINEAPPLE_PROFILE.doors) {
      const hinge = new TransformNode(`model-pineapple-door-${door.id}`, scene);
      hinge.parent = house;
      hinge.position.set(door.hinge[0], door.y, door.hinge[1]);
      this.doors.set(door.id, { node: hinge, swing: door.swing, open: false, at: 0 });
    }
    for (const part of PINEAPPLE_PARTS) {
      const parent = part.door ? this.doors.get(part.door)!.node : house;
      loader.add({ x: PINEAPPLE_PLACEMENT.x, z: PINEAPPLE_PLACEMENT.z, load: () => fetchPart(scene, part, parent) });
    }
  }

  // A door's state from the Room: swung over the next DOOR_SWING_SECONDS, or set at once.
  setDoor(id: string, open: boolean, swing = true): void {
    const door = this.doors.get(id);
    if (!door || door.open === open) return;
    door.open = open;
    door.at = swing ? performance.now() : -Infinity;
  }

  update(): void {
    const now = performance.now();
    for (const door of this.doors.values()) {
      const t = Math.min(1, (now - door.at) / (DOOR_SWING_SECONDS * 1000));
      const eased = 1 - (1 - t) * (1 - t); // fast off the latch, settling at the end
      const open = door.open ? eased : 1 - eased;
      // The sim's swing turns from +x toward +z; Babylon's turn about y goes the other way round.
      door.node.rotation.y = -door.swing * open;
    }
  }
}

// Fetches a part and hangs its mesh on `parent`: counts (Uint32 vertices, triangles), positions in
// centimetres (Int16), texture coordinates (Uint16, UV_UNIT to the repeat), triangles (Uint16),
// unit normals (Int8). Drawn both sides: the leaves and the rooms' walls are single sheets.
async function fetchPart(scene: Scene, part: PineapplePart, parent: TransformNode): Promise<void> {
  const buffer = await (await fetch(`/assets/models/pineapple-${part.name}.bin`)).arrayBuffer();
  const [vertices, triangles] = new Uint32Array(buffer, 0, 2);
  let at = 8;
  const positions = new Int16Array(buffer, at, vertices * 3);
  at += vertices * 6;
  const uvs = new Uint16Array(buffer, at, vertices * 2);
  at += vertices * 4;
  const indices = new Uint16Array(buffer, at, triangles * 3);
  at += triangles * 6;
  const normals = new Int8Array(buffer, at, vertices * 3);
  const data = new VertexData();
  data.positions = Array.from(positions, (cm) => cm / 100);
  data.uvs = Array.from(uvs, (u) => u / UV_UNIT);
  data.indices = Array.from(indices);
  data.normals = Array.from(normals, (n) => n / 127);
  const mesh = new Mesh(`model-pineapple-${part.name}`, scene);
  data.applyToMesh(mesh);
  const image = new Texture(
    `/assets/textures/models/${part.texture}.png`,
    scene,
    false,
    false,
    Texture.NEAREST_NEAREST_MIPLINEAR,
  );
  if (part.wrap) image.wrapU = image.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = new StandardMaterial(`model-pineapple-${part.name}`, scene);
  material.diffuseTexture = image;
  material.emissiveTexture = image;
  material.specularColor = Color3.Black();
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  if (part.unlit) {
    // Indoors: every surface shows its texture as painted, whichever way it faces.
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
  } else material.emissiveColor = new Color3(GLOW, GLOW, GLOW);
  if (part.alpha) {
    // Clear pixels (the rooms' net ceilings) are cut out, not blended, so nothing sorts.
    image.hasAlpha = true;
    material.useAlphaFromDiffuseTexture = true;
    material.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST;
    material.alphaCutOff = 0.5;
  }
  if (part.opacity !== undefined) {
    material.alpha = part.opacity;
    material.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
  }
  mesh.material = material;
  mesh.parent = parent;
  mesh.isPickable = false;
}
