// A model from scripts/avatar-model.py: one textured mesh skinned on the GPU over a few bones. A
// transform node per bone, parented like the bones and placed at its pivot, drives the skeleton:
// turning a node bends the skin there, and anything hung on the node (a held item) follows it.
import {
  Bone,
  Color3,
  Matrix,
  Mesh,
  Skeleton,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import type { Engine } from '../Engine';

const GLOW = 0.3; // how much the skin lights itself, so it reads in the dark like the other avatars

// What the generated model files hold; `bones` is each bone's pivot in the avatar's frame, in the
// order the vertices' bone indices count through.
export interface SkinnedModel<B extends string> {
  readonly hand: readonly number[];
  readonly back: readonly number[];
  readonly lie: number;
  readonly bones: Readonly<Record<B, readonly number[]>>;
  readonly positions: string;
  readonly normals: string;
  readonly uvs: string;
  readonly indices: string;
  readonly boneIndices: string;
  readonly boneWeights: string;
}

export class SkinnedBody<B extends string> {
  readonly mesh: Mesh;
  readonly material: StandardMaterial;
  private readonly skeleton: Skeleton;
  private readonly parts = new Map<B, { node: TransformNode; pivot: readonly number[] }>();

  // `parents` names each bone's parent (the root's is null); a bone comes after its parent in the
  // model. The nodes hang off `root`, the bones' frame.
  constructor(
    engine: Engine,
    name: string,
    model: SkinnedModel<B>,
    texture: string,
    parents: Readonly<Record<B, B | null>>,
    root: TransformNode,
  ) {
    const scene = engine.scene;
    this.skeleton = new Skeleton(name, name, scene);
    this.skeleton.useTextureToStoreBoneMatrices = false; // a handful of bones fit in uniforms
    const bones = new Map<B, Bone>();
    (Object.keys(model.bones) as B[]).forEach((name, index) => {
      const parent = parents[name];
      const base = parent ? this.part(parent) : null;
      const pivot = model.bones[name];
      const from = base?.pivot ?? [0, 0, 0];
      const node = new TransformNode(`${this.skeleton.name}-${name}`, scene);
      node.parent = base?.node ?? root;
      node.position.set(pivot[0] - from[0], pivot[1] - from[1], pivot[2] - from[2]);
      const local = Matrix.Translation(node.position.x, node.position.y, node.position.z);
      const bone = new Bone(name, this.skeleton, parent ? bones.get(parent)! : null, local, null, null, index);
      bone.linkTransformNode(node);
      bones.set(name, bone);
      this.parts.set(name, { node, pivot });
    });

    this.material = skinMaterial(scene, name, texture);
    this.mesh = new Mesh(`${name}-mesh`, scene);
    vertexData(model).applyToMesh(this.mesh);
    this.mesh.material = this.material;
    this.mesh.skeleton = this.skeleton;
    this.mesh.parent = root;
    this.mesh.isPickable = false;
  }

  node(bone: B): TransformNode {
    return this.part(bone).node;
  }

  // A point in the avatar's frame as an offset from a bone's pivot: where to hang something on its node.
  offset(bone: B, point: readonly number[]): Vector3 {
    const { pivot } = this.part(bone);
    return new Vector3(point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]);
  }

  // The mesh and material go with the avatar's root; the skeleton is the scene's until told.
  dispose(): void {
    this.skeleton.dispose();
  }

  private part(bone: B): { node: TransformNode; pivot: readonly number[] } {
    const part = this.parts.get(bone);
    if (!part) throw new Error(`${this.skeleton.name} has no bone ${bone}`);
    return part;
  }
}

// The model's texture, lit, with a little of itself as glow. glTF texture coordinates run down the
// image, so it isn't flipped on load. Sampled nearest like the world's textures.
export function skinMaterial(scene: Engine['scene'], name: string, texture: string): StandardMaterial {
  const image = new Texture(texture, scene, false, false, Texture.NEAREST_NEAREST_MIPLINEAR);
  const material = new StandardMaterial(`${name}-skin`, scene);
  material.diffuseTexture = image;
  material.emissiveTexture = image;
  material.emissiveColor = new Color3(GLOW, GLOW, GLOW);
  material.specularColor = new Color3(0.06, 0.06, 0.06);
  material.specularPower = 8;
  return material;
}

const decoded = new Map<string, VertexData>();

// A model's mesh, decoded once per page (keyed by its vertices): the same arrays go into every
// wearer's own buffers.
function vertexData(m: SkinnedModel<string>): VertexData {
  let data = decoded.get(m.positions);
  if (data) return data;
  data = new VertexData();
  data.positions = Array.from(new Int16Array(bytes(m.positions).buffer), (mm) => mm / 1000);
  data.normals = Array.from(new Int8Array(bytes(m.normals).buffer), (n) => n / 127);
  data.uvs = Array.from(new Uint16Array(bytes(m.uvs).buffer), (u) => u / 65535);
  data.indices = Array.from(new Uint16Array(bytes(m.indices).buffer));
  data.matricesIndices = Array.from(bytes(m.boneIndices));
  data.matricesWeights = Array.from(bytes(m.boneWeights), (w) => w / 255);
  decoded.set(m.positions, data);
  return data;
}

export function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
