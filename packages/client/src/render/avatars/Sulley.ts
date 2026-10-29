// Sulley (Monsters, Inc.): 2.6 m of teal fur with purple spots, from Guilherme Navarro's low-poly
// model (sulleyModel.ts, made by scripts/sulley-model.py), one textured mesh skinned on the GPU over
// eight bones: hips, chest, head, the arms, the legs and the tail. A transform node per bone drives
// the skeleton, so the skin bends at the joints and a held item rides the right arm like anything
// else hung on a node. It lumbers: short legs stride, the long arms swing against them, the chest
// rolls, the tail sways on its own, and the head follows the look. It dies flat on its back with the
// tail out to one side. Worn with /sulley; its hit capsule is sized to it (AVATARS.sulley.hitbox),
// movement and items are everyone's.
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
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, Gait, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SULLEY_MODEL } from './sulleyModel';

const TEXTURE = '/assets/textures/avatars/sulley.png';
const GLOW = 0.3; // how much the fur lights itself, so it reads in the dark like the other avatars
const LEG_SWING = 0.55; // radians each way at a full-speed walk
const ARM_SWING = 0.3;
const ROLL = 0.06; // radians the chest rolls side to side with each stride
const BOB = 0.04; // metres the body rises mid-stride
const HEAD_FOLLOW = 0.5; // how much of the look's pitch the head takes
const TAIL_SWAY = 0.25; // radians each way, all the time
const TAIL_SWAY_MS = 1600;
// Lying on its back: radians the legs and arms drop toward the ground and the head tips back.
const DEAD_LEGS = 1.0;
const DEAD_ARMS = 1.2;
const DEAD_HEAD = -0.4;

type BoneName = keyof typeof SULLEY_MODEL.bones;
interface Part {
  node: TransformNode;
  bone: Bone | null;
  pivot: readonly number[];
}

export class SulleyAvatar implements Avatar {
  readonly kind = 'sulley' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly chest: TransformNode;
  private readonly head: TransformNode;
  private readonly armL: TransformNode;
  private readonly armR: TransformNode;
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly tail: TransformNode;
  private readonly skeleton: Skeleton;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly swayOffset: number;
  private dead = false;
  private readonly gait = new Gait(4.2);

  constructor(
    engine: Engine,
    readonly id: string,
  ) {
    const scene = engine.scene;
    const model = SULLEY_MODEL;
    this.swayOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TAIL_SWAY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    // A bone per entry of the model, in its order (the vertices' bone indices), parented here and
    // placed at its pivot. Each is linked to a node in the same hierarchy: turning the node turns
    // the bone, and anything hung on the node (the held item) follows the skin.
    const skeleton = new Skeleton(`sulley-${id}`, `sulley-${id}`, scene);
    skeleton.useTextureToStoreBoneMatrices = false; // eight bones fit in uniforms
    this.skeleton = skeleton;
    const boneIndex = Object.keys(model.bones);
    const part = (name: BoneName, parent: Part): Part => {
      const pivot = model.bones[name];
      const node = new TransformNode(`sulley-${name}-${id}`, scene);
      node.parent = parent.node;
      node.position.set(pivot[0] - parent.pivot[0], pivot[1] - parent.pivot[1], pivot[2] - parent.pivot[2]);
      const local = Matrix.Translation(node.position.x, node.position.y, node.position.z);
      const bone = new Bone(name, skeleton, parent.bone, local, null, null, boneIndex.indexOf(name));
      bone.linkTransformNode(node);
      return { node, bone, pivot };
    };
    const hips = part('hips', { node: this.body, bone: null, pivot: [0, 0, 0] });
    const chest = part('chest', hips);
    this.chest = chest.node;
    this.head = part('head', chest).node;
    this.armL = part('armL', chest).node;
    const armR = part('armR', chest);
    this.armR = armR.node;
    this.legL = part('legL', hips).node;
    this.legR = part('legR', hips).node;
    this.tail = part('tail', hips).node;

    // The fur is the model's texture, lit, with a little of itself as glow. glTF texture coordinates
    // run down the image, so it isn't flipped on load. Sampled nearest like the world's textures.
    const texture = new Texture(TEXTURE, scene, false, false, Texture.NEAREST_NEAREST_MIPLINEAR);
    const fur = new StandardMaterial(`sulley-fur-${id}`, scene);
    fur.diffuseTexture = texture;
    fur.emissiveTexture = texture;
    fur.emissiveColor = new Color3(GLOW, GLOW, GLOW);
    fur.specularColor = new Color3(0.06, 0.06, 0.06);
    fur.specularPower = 8;
    this.hitFlash = new HitFlash([fur]);

    const mesh = new Mesh(`sulley-mesh-${id}`, scene);
    vertexData().applyToMesh(mesh);
    mesh.material = fur;
    mesh.skeleton = skeleton;
    mesh.parent = this.body;
    mesh.isPickable = false;

    // A held item goes in the right palm; the arm points forward while holding one so it reads as
    // aiming. The flamethrower's tank hangs on the back below the shoulders.
    const { hand, back } = model;
    this.items = new HeldItems(
      engine,
      `sulley-${id}`,
      this.armR,
      new Vector3(hand[0] - armR.pivot[0], hand[1] - armR.pivot[1], hand[2] - armR.pivot[2]),
      this.chest,
      new Vector3(back[0] - chest.pivot[0], back[1] - chest.pivot[1], back[2] - chest.pivot[2]),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.7);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;
    this.head.rotation.x = p.pitch * HEAD_FOLLOW;

    this.gait.update(p.x, p.z, airborne);
    const { phase, effort } = this.gait;
    const swing = airborne ? 0.3 : Math.sin(phase) * effort * LEG_SWING;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = (-swing * ARM_SWING) / LEG_SWING;
    this.armR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : (swing * ARM_SWING) / LEG_SWING;
    this.chest.rotation.z = airborne ? 0 : Math.sin(phase) * ROLL * effort;
    this.body.position.y = airborne ? 0 : Math.abs(Math.sin(phase)) * BOB * effort;
    this.tail.rotation.y = Math.sin(((performance.now() + this.swayOffset) / TAIL_SWAY_MS) * 2 * Math.PI) * TAIL_SWAY;
    this.items.update(p);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Toppled onto its back, head away from where it was going, the hips as high as the body is
      // deep so it lies on the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? SULLEY_MODEL.lie : 0;
    }
    if (p.dead) {
      // Limbs dropped to the ground either side, the head back, the tail out of the floor.
      this.legL.rotation.x = this.legR.rotation.x = DEAD_LEGS;
      this.armL.rotation.x = this.armR.rotation.x = DEAD_ARMS;
      this.head.rotation.x = DEAD_HEAD;
      this.chest.rotation.z = 0;
      this.body.position.y = SULLEY_MODEL.lie;
      this.tail.rotation.y = Math.PI / 2;
    }
    placeShadow(this.shadow, p, feetY);
    this.root.setEnabled(true);
  }

  flash(): void {
    this.hitFlash.trigger();
  }

  hide(): void {
    this.root.setEnabled(false);
  }

  dispose(): void {
    this.root.dispose(false, true);
    this.skeleton.dispose();
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.body) : null;
  }
}

let decoded: VertexData | null = null;

// The model's mesh, decoded once per page: the same arrays go into every Sulley's own buffers.
function vertexData(): VertexData {
  if (decoded) return decoded;
  const m = SULLEY_MODEL;
  decoded = new VertexData();
  decoded.positions = Array.from(new Int16Array(bytes(m.positions).buffer), (mm) => mm / 1000);
  decoded.normals = Array.from(new Int8Array(bytes(m.normals).buffer), (n) => n / 127);
  decoded.uvs = Array.from(new Uint16Array(bytes(m.uvs).buffer), (u) => u / 65535);
  decoded.indices = Array.from(new Uint16Array(bytes(m.indices).buffer));
  decoded.matricesIndices = Array.from(bytes(m.boneIndices));
  decoded.matricesWeights = Array.from(bytes(m.boneWeights), (w) => w / 255);
  return decoded;
}

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
