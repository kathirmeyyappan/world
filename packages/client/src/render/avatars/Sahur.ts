// Tung Tung Tung Sahur: a 3.2 m wooden log with a face (60% taller than everyone else), built from a
// sculpt of the character decimated to a few thousand triangles (sahurModel.ts, made by
// scripts/sahur-model.py). The sculpt comes in parts the avatar moves on their own: the body with its
// arms, the bat in the right hand, and each leg. The skin shades from orange-brown at the hips to
// yellow at the top of the head, and the eyes are the avatar's own: white balls that are mostly
// pupil, staring fixed and a little wall-eyed. It walks stiff-legged, twitches its head now and then,
// and dies flat on its back. Bot-only (AVATARS.sahur isn't wearable); the hit capsule, movement and
// items are everyone's, and a held item replaces the bat.
import { Color3, Mesh, MeshBuilder, TransformNode, Vector3, VertexData, type StandardMaterial } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';
import { SAHUR_MODEL } from './sahurModel';

const PUPIL = 0.7; // pupil diameter as a fraction of the eyeball's
const EYE_SIZE = 1.02; // the eyeball's radius as a fraction of the sculpt's (a closed lid): it covers it, wide open
const EYE_SINK = -0.012; // metres the eyeball sits back from the sculpt's own (negative: forward)
const STARE_OUT = 0.06; // radians each eye turns outward: the gaze never quite meets yours
const CREASE_DARKEN = 0.6; // how much of the skin's colour the deepest crease loses
const LIE_HEIGHT = 0.28; // metres the fallen log's centre line sits above the ground (its half-depth)
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id

// Skin by height, in metres above the feet: orange-brown on the body, yellow on the head.
const SKIN = [
  { y: 0, c: new Color3(0.72, 0.34, 0.1) },
  { y: 1.9, c: new Color3(0.9, 0.5, 0.13) },
  { y: 2.45, c: new Color3(0.98, 0.7, 0.16) },
  { y: 3.2, c: new Color3(1, 0.8, 0.2) },
];

type PartKey = keyof typeof SAHUR_MODEL.parts;

export class SahurAvatar implements Avatar {
  readonly kind = 'sahur' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly log: TransformNode; // everything above the hips, which sways and twitches
  private readonly legL: TransformNode;
  private readonly legR: TransformNode;
  private readonly bat: Mesh;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
  private readonly twitchOffset: number;
  private dead = false;
  private phase = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(
    engine: Engine,
    readonly id: string,
    name: string,
    color: string,
  ) {
    const scene = engine.scene;
    const model = SAHUR_MODEL;
    const hip = model.parts.body.pivot[1];
    this.twitchOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TWITCH_EVERY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    // Coloured per vertex (skinColours), which tints the glow as well as the lit colour.
    const skin = glossy(flat(scene, `sahur-skin-${id}`, Color3.White(), 0.34));
    const batMat = glossy(flat(scene, `sahur-bat-${id}`, new Color3(0.62, 0.33, 0.14), 0.3));
    const white = glossy(flat(scene, `sahur-white-${id}`, new Color3(0.97, 0.96, 0.93), 0.5));
    const black = flat(scene, `sahur-black-${id}`, new Color3(0.01, 0.01, 0.01), 0);
    this.hitFlash = new HitFlash([skin, batMat]);

    // A node at a part's pivot (given in the avatar's frame, so offset by the parent's own pivot),
    // with the part's mesh hung on it.
    const part = (key: PartKey, parent: TransformNode, offset: readonly number[], mat: StandardMaterial) => {
      const { pivot } = model.parts[key];
      const node = new TransformNode(`sahur-${key}-${id}`, scene);
      node.parent = parent;
      node.position.set(pivot[0] - offset[0], pivot[1] - offset[1], pivot[2] - offset[2]);
      const mesh = partMesh(scene, `sahur-${key}-mesh-${id}`, model.parts[key], mat === skin);
      mesh.material = mat;
      mesh.parent = node;
      mesh.isPickable = false;
      return { node, mesh };
    };
    const origin = [0, 0, 0];
    this.log = part('body', this.body, origin, skin).node;
    this.legL = part('legL', this.body, origin, skin).node;
    this.legR = part('legR', this.body, origin, skin).node;
    this.bat = part('bat', this.log, model.parts.body.pivot, batMat).mesh;

    // Eyes: a white ball in each of the sculpt's sockets, the front mostly pupil, fixed and turned a
    // little outward.
    const r = model.eyeRadius * EYE_SIZE;
    for (const [i, [x, y, z]] of model.eyes.entries()) {
      const side = x > 0 ? 1 : -1;
      const ball = MeshBuilder.CreateSphere(`sahur-eye-${i}-${id}`, { diameter: r * 2, segments: 10 }, scene);
      ball.material = white;
      ball.parent = this.log;
      ball.position.set(x, y - hip, z - EYE_SINK); // over the sculpt's closed lid, inside its orbit
      ball.isPickable = false;
      const pupil = MeshBuilder.CreateDisc(`sahur-pupil-${i}-${id}`, { radius: r * PUPIL, tessellation: 18 }, scene);
      pupil.material = black;
      pupil.parent = ball;
      pupil.rotation.set(0.04, Math.PI + side * STARE_OUT, 0); // a disc faces -z; turn it to face out
      pupil.position.set(Math.sin(side * STARE_OUT) * r * 1.01, -0.04 * r, Math.cos(STARE_OUT) * r * 1.01);
      pupil.isPickable = false;
    }

    // A held item goes in the right hand instead of the bat; the flamethrower's tank rides on the back.
    const hand = new TransformNode(`sahur-hand-${id}`, scene);
    hand.parent = this.log;
    hand.position.set(model.hand[0], model.hand[1] - hip, model.hand[2]);
    this.items = new HeldItems(engine, `sahur-${id}`, hand, Vector3.Zero(), this.log, new Vector3(0, 1.0, -0.4));

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.3);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;

    const tag = createTag(engine, id, name, color);
    tag.parent = this.root;
    tag.position.y = model.height + 0.4;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    const hip = SAHUR_MODEL.parts.body.pivot[1];
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;

    // Stilted walk: stiff legs swing from the hip and the log bobs; the arms keep hanging.
    if (moved > 0.002 && !airborne) this.phase += moved * 3.6;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const swing = airborne ? 0.15 : Math.sin(this.phase) * 0.32 * effort;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.log.position.y = hip + (airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.05 * effort);

    // The log leans a little with the look and sways slowly; every few seconds, a short jerk sideways.
    const now = performance.now();
    const sinceTwitch = (now + this.twitchOffset) % TWITCH_EVERY_MS;
    const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
    this.log.rotation.set(p.pitch * 0.12, 0, Math.sin(now / 1700 + this.twitchOffset) * 0.03 + twitch);

    this.bat.setEnabled(!p.item);
    this.items.update(p.item, p.firing);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen flat on its back like a felled log, face to the sky, lifted to lie on the ground
      // rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? LIE_HEIGHT : 0;
    }
    if (p.dead) {
      this.legL.rotation.x = this.legR.rotation.x = 0;
      this.log.rotation.set(0, 0, 0);
      this.log.position.y = hip;
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
  }

  corpse(): Vector3 | null {
    return this.dead && this.root.isEnabled() ? centreOf(this.body) : null;
  }
}

// Smooth and a little shiny.
function glossy(m: StandardMaterial): StandardMaterial {
  m.specularColor = new Color3(0.25, 0.2, 0.12);
  m.specularPower = 20;
  return m;
}

// One part of the sculpt as a smooth-shaded mesh in its pivot's frame, skin-coloured by height when
// `painted`.
function partMesh(
  scene: Engine['scene'],
  name: string,
  part: {
    readonly pivot: readonly number[];
    readonly positions: string;
    readonly indices: string;
    readonly cavity: string;
  },
  painted: boolean,
): Mesh {
  const positions = Array.from(new Int16Array(bytes(part.positions).buffer), (mm) => mm / 1000);
  const indices = Array.from(new Uint16Array(bytes(part.indices).buffer));
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals);
  if (painted) data.colors = skinColours(positions, part.pivot[1], bytes(part.cavity));
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

// Per-vertex skin colour (r, g, b, a) for vertices `lift` metres above the feet in their own frame,
// darkened into the sculpt's creases (`cavity`, 0 to 255 per vertex).
function skinColours(positions: number[], lift: number, cavity: Uint8Array): number[] {
  const colors: number[] = [];
  for (let i = 1; i < positions.length; i += 3) {
    const y = Math.max(SKIN[0].y, Math.min(SKIN[SKIN.length - 1].y, positions[i] + lift));
    let k = 1;
    while (k < SKIN.length - 1 && SKIN[k].y < y) k++;
    const c = Color3.Lerp(SKIN[k - 1].c, SKIN[k].c, (y - SKIN[k - 1].y) / (SKIN[k].y - SKIN[k - 1].y));
    const shade = 1 - CREASE_DARKEN * (cavity[(i - 1) / 3] / 255);
    colors.push(c.r * shade, c.g * shade * shade, c.b * shade * shade, 1); // creases go brown, not grey
  }
  return colors;
}

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
