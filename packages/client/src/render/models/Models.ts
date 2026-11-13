// Landmarks drawn from mesh files rather than built from structures: the pineapple house, in the
// parts scripts/house-model.py writes (render/models/pineappleParts.ts), and the Krusty Krab, in
// those scripts/krusty-krab-model.py writes (render/models/krustyKrabParts.ts), each fetched
// through the loader (render/Loader.ts) and stood where the shared content puts it
// (content/pineapple.ts, content/krustyKrab.ts). The sim never sees these meshes; it collides with
// the structures the content hides inside them, so what you bump into is theirs to keep true to the
// models. Each door hangs on a node at its pin and swings to the state the Room tells us
// (sim/doors.ts) over DOOR_SWING_SECONDS; a door of two leaves has a node for each.
import { Color3, Mesh, StandardMaterial, Texture, TransformNode, VertexData, type Scene } from '@babylonjs/core';
import {
  DOOR_SWING_SECONDS,
  KRUSTY_KRAB_DOOR,
  KRUSTY_KRAB_PLACEMENT,
  KRUSTY_KRAB_PROFILE,
  PINEAPPLE_PLACEMENT,
  PINEAPPLE_PROFILE,
} from '@world/shared';
import type { Engine } from '../Engine';
import type { Loader } from '../Loader';
import { KRUSTY_KRAB_PARTS } from './krustyKrabParts';
import { PINEAPPLE_PARTS } from './pineappleParts';

const GLOW = 0.3; // how much a model lights itself, like the avatars, so it reads at night
const UV_UNIT = 4096; // texture coordinate units to the repeat in the mesh files

// One part of a model, as the scripts list them: its mesh (<name>.bin in the model's folder), its
// texture (<texture>.png beside it), whether the texture repeats or is an atlas, whether it has
// clear pixels, whether it's drawn as painted rather than lit, how solid it's drawn if it's
// see-through, whether only its outside is drawn, and the hinge it hangs on, if it swings.
interface Part {
  name: string;
  texture: string;
  wrap: boolean;
  alpha?: boolean;
  unlit?: boolean;
  opacity?: number;
  oneSided?: boolean;
  door?: string;
}

// A model: its folder under /assets/models, where it stands, its parts, and its hinges, each
// named as the parts name it, with its pin in the model's frame, how far it swings, and the sim's
// door it belongs to.
interface Model {
  name: string;
  placement: { x: number; y: number; z: number; yaw: number };
  parts: readonly Part[];
  hinges: { name: string; door: string; at: readonly [number, number]; y: number; swing: number }[];
}

const MODELS: Model[] = [
  {
    name: 'pineapple',
    placement: PINEAPPLE_PLACEMENT,
    parts: PINEAPPLE_PARTS,
    hinges: PINEAPPLE_PROFILE.doors.map((d) => ({ name: d.id, door: d.id, at: d.hinge, y: d.y, swing: d.swing })),
  },
  {
    name: 'krusty-krab',
    placement: KRUSTY_KRAB_PLACEMENT,
    parts: KRUSTY_KRAB_PARTS,
    hinges: KRUSTY_KRAB_PROFILE.doors.map((d) => ({
      name: d.part,
      door: KRUSTY_KRAB_DOOR,
      at: d.hinge,
      y: 0,
      swing: d.swing,
    })),
  },
];

interface Hinge {
  node: TransformNode;
  swing: number;
}

export class Models {
  // Each of the sim's doors: its hinges, whether it stands open, and when it last began to swing.
  private readonly doors = new Map<string, { hinges: Hinge[]; open: boolean; at: number }>();

  constructor(engine: Engine, loader: Loader) {
    const scene = engine.scene;
    for (const model of MODELS) {
      const root = new TransformNode(`model-${model.name}`, scene);
      root.position.set(model.placement.x, model.placement.y, model.placement.z);
      root.rotation.y = model.placement.yaw;
      const hinges = new Map<string, TransformNode>();
      for (const hinge of model.hinges) {
        const node = new TransformNode(`model-${model.name}-door-${hinge.name}`, scene);
        node.parent = root;
        node.position.set(hinge.at[0], hinge.y, hinge.at[1]);
        hinges.set(hinge.name, node);
        const door = this.doors.get(hinge.door) ?? { hinges: [], open: false, at: 0 };
        door.hinges.push({ node, swing: hinge.swing });
        this.doors.set(hinge.door, door);
      }
      for (const part of model.parts) {
        const parent = part.door ? hinges.get(part.door)! : root;
        loader.add({
          x: model.placement.x,
          z: model.placement.z,
          load: () => fetchPart(scene, model.name, part, parent),
        });
      }
    }
  }

  // A door's state from the Room: swung over the next DOOR_SWING_SECONDS, or set at once. Turned
  // back mid-swing, it carries on from where it is: the new swing starts as far along as brings
  // it to the old one's angle.
  setDoor(id: string, open: boolean, swing = true): void {
    const door = this.doors.get(id);
    if (!door || door.open === open) return;
    const now = performance.now();
    const at = swung(door, now);
    door.open = open;
    const begun = 1 - Math.sqrt(open ? 1 - at : at);
    door.at = swing ? now - begun * DOOR_SWING_SECONDS * 1000 : -Infinity;
  }

  update(): void {
    const now = performance.now();
    for (const door of this.doors.values()) {
      // The sim's swing turns from +x toward +z; Babylon's turn about y goes the other way round.
      for (const hinge of door.hinges) hinge.node.rotation.y = -hinge.swing * swung(door, now);
    }
  }
}

// How far open a door is drawn at a moment, 0 shut to 1 open: fast off the latch, settling at the end.
function swung(door: { open: boolean; at: number }, now: number): number {
  const t = Math.min(1, (now - door.at) / (DOOR_SWING_SECONDS * 1000));
  const eased = 1 - (1 - t) * (1 - t);
  return door.open ? eased : 1 - eased;
}

// Fetches a part and hangs its mesh on `parent`: counts (Uint32 vertices, triangles), positions in
// centimetres (Int16), texture coordinates (Uint16, UV_UNIT to the repeat), triangles (Uint16),
// unit normals (Int8). Drawn both sides (the leaves and the rooms' walls are single sheets) unless
// the part says nothing looks at its inside.
async function fetchPart(scene: Scene, model: string, part: Part, parent: TransformNode): Promise<void> {
  const buffer = await (await fetch(`/assets/models/${model}/${part.name}.bin`)).arrayBuffer();
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
  const mesh = new Mesh(`model-${model}-${part.name}`, scene);
  data.applyToMesh(mesh);
  const image = new Texture(
    `/assets/models/${model}/${part.texture}.png`,
    scene,
    false,
    false,
    Texture.NEAREST_NEAREST_MIPLINEAR,
  );
  if (part.wrap) image.wrapU = image.wrapV = Texture.WRAP_ADDRESSMODE;
  const material = new StandardMaterial(`model-${model}-${part.name}`, scene);
  material.diffuseTexture = image;
  material.emissiveTexture = image;
  material.specularColor = Color3.Black();
  material.backFaceCulling = part.oneSided ?? false;
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
