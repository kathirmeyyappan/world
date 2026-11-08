// Tung Tung Tung Sahur: a 3.2 m wooden log with a face (60% taller than everyone else), built from a
// sculpt of the character decimated to a few thousand triangles (sahurModel.ts, made by
// scripts/sahur-model.py). The sculpt comes in parts the avatar moves on their own: the body with its
// left arm, the right arm, the bat in its hand, and each leg. The skin shades from orange-brown at the
// hips to yellow at the top of the head, and the eyes are the avatar's own: white balls that are
// mostly pupil, staring fixed and a little wall-eyed. It walks stiff-legged, twitches its head now and
// then, and dies flat on its back. Worn with /tung; its hit capsule is as tall as it is
// (AVATARS.sahur.hitbox), and a held item replaces the bat. The sculpt's right arm is cut from the log
// as a part of its own, so holding an item it comes up from the shoulder, elbow bent, the item in its
// fist pointed along the look, like a stick-up.
import { Color3, Mesh, MeshBuilder, TransformNode, Vector3, VertexData, type StandardMaterial } from '@babylonjs/core';
import type { Engine } from '../Engine';
import { flat } from './common';
import { SAHUR_MODEL } from './sahurModel';
import type { Figure } from './Walker';

const PUPIL = 0.7; // pupil diameter as a fraction of the eyeball's
const EYE_SIZE = 1.02; // the eyeball's radius as a fraction of the sculpt's (a closed lid): it covers it, wide open
const EYE_SINK = -0.012; // metres the eyeball sits back from the sculpt's own (negative: forward)
const STARE_OUT = 0.06; // radians each eye turns outward: the gaze never quite meets yours
const CREASE_DARKEN = 0.6; // how much of the skin's colour the deepest crease loses
const LIE_HEIGHT = 0.28; // metres the fallen log's centre line sits above the ground (its half-depth)
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id
const LEAN = 0.12; // how much of the look's pitch the log leans by
const BEND = Math.PI / 6; // radians the raised arm stays below the look, the elbow bent

// Skin by height, in metres above the feet: orange-brown on the body, yellow on the head.
const SKIN = [
  { y: 0, c: new Color3(0.72, 0.34, 0.1) },
  { y: 1.9, c: new Color3(0.9, 0.5, 0.13) },
  { y: 2.45, c: new Color3(0.98, 0.7, 0.16) },
  { y: 3.2, c: new Color3(1, 0.8, 0.2) },
];

type PartKey = keyof typeof SAHUR_MODEL.parts;

export function buildSahur(engine: Engine, id: string, base: TransformNode): Figure {
  const scene = engine.scene;
  const model = SAHUR_MODEL;
  const twitchOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TWITCH_EVERY_MS;

  // Coloured per vertex (skinColours), which tints the glow as well as the lit colour.
  const skin = glossy(flat(scene, `sahur-skin-${id}`, Color3.White(), 0.34));
  const batMat = glossy(flat(scene, `sahur-bat-${id}`, new Color3(0.62, 0.33, 0.14), 0.3));
  const white = glossy(flat(scene, `sahur-white-${id}`, new Color3(0.97, 0.96, 0.93), 0.5));
  const black = flat(scene, `sahur-black-${id}`, new Color3(0.01, 0.01, 0.01), 0);

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
  const log = part('body', base, origin, skin).node; // everything above the hips, which leans and twitches
  const legL = part('legL', base, origin, skin).node;
  const legR = part('legR', base, origin, skin).node;
  const bat = part('bat', log, model.parts.body.pivot, batMat).mesh;
  const arm = part('armR', log, model.parts.body.pivot, skin).node; // the right arm, turning at the shoulder

  // Eyes: a white ball in each of the sculpt's sockets, the front mostly pupil, fixed and turned a
  // little outward.
  const hip = model.parts.body.pivot[1];
  const r = model.eyeRadius * EYE_SIZE;
  for (const [i, [x, y, z]] of model.eyes.entries()) {
    const side = x > 0 ? 1 : -1;
    const ball = MeshBuilder.CreateSphere(`sahur-eye-${i}-${id}`, { diameter: r * 2, segments: 10 }, scene);
    ball.material = white;
    ball.parent = log;
    ball.position.set(x, y - hip, z - EYE_SINK); // over the sculpt's closed lid, inside its orbit
    ball.isPickable = false;
    const pupil = MeshBuilder.CreateDisc(`sahur-pupil-${i}-${id}`, { radius: r * PUPIL, tessellation: 18 }, scene);
    pupil.material = black;
    pupil.parent = ball;
    pupil.rotation.set(0.04, Math.PI + side * STARE_OUT, 0); // a disc faces -z; turn it to face out
    pupil.position.set(Math.sin(side * STARE_OUT) * r * 1.01, -0.04 * r, Math.cos(STARE_OUT) * r * 1.01);
    pupil.isPickable = false;
  }

  // A held item goes in the fist instead of the bat; the flamethrower's tank rides on the back.
  const grip = new TransformNode(`avatar-grip-${id}`, scene);
  grip.parent = arm;
  const { pivot: shoulder } = model.parts.armR;
  grip.position.set(model.hand[0] - shoulder[0], model.hand[1] - shoulder[1], model.hand[2] - shoulder[2]);

  return {
    tilt: { node: log, follow: LEAN },
    legs: [
      { node: legL, side: 1 },
      { node: legR, side: -1 },
    ],
    armR: { node: arm, grip, reach: Vector3.Down() },
    back: { node: log, at: new Vector3(0, 1.0, -0.4) },
    materials: [skin, batMat],
    shadow: 1.3,
    legSwing: 0.32, // stiff legs swing from the hip
    airLegs: 0.15,
    armSwing: 0, // the arms keep hanging, the fist on the bat
    bob: 0.05,
    bend: BEND,
    lie: { onto: 'back', height: LIE_HEIGHT }, // flat on its back like a felled log, face to the sky
    // The bat is in the fist unless an item is. The log sways slowly and, every few seconds, jerks
    // sideways for a moment; dead, it lies still.
    extra: (p) => {
      bat.setEnabled(!p.item);
      if (p.dead) {
        log.rotation.z = 0;
        return;
      }
      const now = performance.now();
      const sinceTwitch = (now + twitchOffset) % TWITCH_EVERY_MS;
      const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
      log.rotation.z = Math.sin(now / 1700 + twitchOffset) * 0.03 + twitch;
    },
  };
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
