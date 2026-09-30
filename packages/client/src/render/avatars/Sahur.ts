// Tung Tung Tung Sahur: a 3.2 m smooth wooden log (60% taller than everyone else), a rounded box in
// section, shading from yellow at its flat-topped head to orange-brown below, with a face on a raised
// plate: big round eyeballs that are mostly pupil under heavy lids and a brow ridge, a long hooked
// nose, cheekbones that jut past the log's sides, and a wide smile over a chin. Thin arms hang from
// mouth height to the bottom of the log, the right one trailing a bat to the ground; thin legs end in
// big feet. It walks stiff-legged, twitches its head now and then, and dies flat on its back.
// Proportions follow a reference sculpt of the character. Bot-only (AVATARS.sahur isn't wearable);
// the hit capsule, movement and items are everyone's, and a held item replaces the bat.
import {
  Color3,
  Mesh,
  MeshBuilder,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type StandardMaterial,
} from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

// Metres, feet at 0. The log stands on the hips and runs to the top of the head; everything on the
// log is in its frame (y above the hips, z forward from its centre line).
const HEIGHT = 3.2;
const HIP = 1.02;
const LOG = HEIGHT - HIP;
const HALF_W = 0.35; // the log's half-width
const HALF_D = 0.28; // and half-depth
const PLATE = { bottom: 0.9, top: 2.0, front: 0.42 }; // the raised face, and how far forward it stands
const EYE = { x: 0.2, y: 1.63, r: 0.12 };
const PUPIL = 0.68; // pupil diameter as a fraction of the eyeball's
const STARE_OUT = 0.05; // radians each eye turns outward: the gaze never quite meets yours
const NOSE = { top: 1.58, tip: 1.33, out: 0.6 };
const MOUTH_Y = 1.13;
const SHOULDER = { x: HALF_W + 0.03, y: 1.22 };
const UPPER_ARM = 0.6;
const FOREARM = 0.56;
const THIGH = 0.52;
const SHIN = 0.5;
const TWITCH_EVERY_MS = 4300; // roughly; each avatar's twitches are offset by its id

// Skin up the log (t from 0 at the hips to 1 at the top): orange-brown on the body, yellow on the head.
const SKIN = [
  { t: 0, c: new Color3(0.7, 0.36, 0.13) },
  { t: 0.4, c: new Color3(0.85, 0.48, 0.15) },
  { t: 0.66, c: new Color3(0.94, 0.68, 0.2) },
  { t: 1, c: new Color3(0.98, 0.8, 0.25) },
];
const LIMB = new Color3(0.82, 0.46, 0.17);

interface Limb {
  top: TransformNode; // pivot at the shoulder or hip
  joint: TransformNode; // pivot at the elbow or knee
  end: TransformNode; // the hand or foot
}

export class SahurAvatar implements Avatar {
  readonly kind = 'sahur' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly log: TransformNode; // everything above the hips, which sways and twitches
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly bat: TransformNode;
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
    this.twitchOffset = [...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) % TWITCH_EVERY_MS;
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;
    this.log = new TransformNode(`sahur-log-${id}`, scene);
    this.log.parent = this.body;
    this.log.position.y = HIP;

    // Coloured per vertex (paintSkin), which tints the glow as well as the lit colour.
    const skin = glossy(flat(scene, `sahur-skin-${id}`, Color3.White(), 0.38));
    const limbMat = glossy(flat(scene, `sahur-limb-${id}`, LIMB, 0.4));
    const shade = flat(scene, `sahur-shade-${id}`, new Color3(0.35, 0.19, 0.08), 0.1);
    const white = glossy(flat(scene, `sahur-white-${id}`, new Color3(0.97, 0.96, 0.93), 0.5));
    const black = flat(scene, `sahur-black-${id}`, new Color3(0.01, 0.01, 0.01), 0);
    const batMat = glossy(flat(scene, `sahur-bat-${id}`, new Color3(0.7, 0.4, 0.17), 0.3));
    this.hitFlash = new HitFlash([skin, limbMat, batMat]);

    // The head and body are modelled in the log's frame, then merged into one mesh per material and
    // hung on the log: four draw calls for all of it.
    const parts = new Map<StandardMaterial, Mesh[]>();
    const add = (m: Mesh, mat: StandardMaterial) => {
      parts.set(mat, [...(parts.get(mat) ?? []), m]);
      return m;
    };
    const ball = (mat: StandardMaterial, at: Vector3, radii: Vector3, tilt = Vector3.Zero()) => {
      const m = MeshBuilder.CreateSphere(`sahur-part-${id}`, { diameter: 2, segments: 12 }, scene);
      m.position.copyFrom(at);
      m.scaling.copyFrom(radii);
      m.rotation.copyFrom(tilt);
      return add(m, mat);
    };
    const tube = (mat: StandardMaterial, path: Vector3[], radius: number) =>
      add(MeshBuilder.CreateTube(`sahur-part-${id}`, { path, radius, tessellation: 8, cap: Mesh.CAP_ALL }, scene), mat);

    // The log, and the face plate standing out from its front between chin and forehead.
    add(roundedBlock(scene, `sahur-part-${id}`, 0, LOG, HALF_W, HALF_D, 0.08), skin);
    const plateDepth = (PLATE.front + 0.02) / 2;
    const plate = roundedBlock(scene, `sahur-part-${id}`, PLATE.bottom, PLATE.top, HALF_W, plateDepth, 0.07);
    plate.position.z = PLATE.front - plateDepth;
    add(plate, skin);

    // Eyes: an eyeball each, mostly pupil, fixed and turned a little outward, under a heavy lid, with a
    // dark rim where it sinks into the face; a brow ridge arches over each.
    for (const side of [-1, 1]) {
      const centre = new Vector3(side * EYE.x, EYE.y, PLATE.front - 0.07);
      ball(white, centre, new Vector3(EYE.r, EYE.r, EYE.r));
      const pupil = MeshBuilder.CreateSphere(`sahur-part-${id}`, { diameter: 2, segments: 12 }, scene);
      const gaze = new Vector3(side * Math.sin(STARE_OUT), -0.05, Math.cos(STARE_OUT)).normalize();
      pupil.position.copyFrom(centre.add(gaze.scale(EYE.r - 0.008)));
      pupil.scaling.set(EYE.r * PUPIL, EYE.r * PUPIL, 0.02);
      pupil.rotation.set(0.05, side * STARE_OUT, 0);
      add(pupil, black);
      const rim = MeshBuilder.CreateTorus(
        `sahur-part-${id}`,
        { diameter: EYE.r * 2.1, thickness: 0.025, tessellation: 20 },
        scene,
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(centre.x, centre.y, PLATE.front - 0.005);
      add(rim, shade);
      ball(skin, new Vector3(centre.x, centre.y + 0.07, centre.z + 0.005), new Vector3(0.13, 0.08, 0.115)); // the lid
      ball(
        skin,
        new Vector3(centre.x, EYE.y + 0.17, PLATE.front - 0.02),
        new Vector3(0.15, 0.05, 0.06),
        new Vector3(0, 0, -side * 0.12),
      ); // the brow
    }

    // Nose: a long bridge from between the eyes out and down to a hooked tip, with a wing either side.
    const from = new Vector3(0, NOSE.top, PLATE.front - 0.01);
    const to = new Vector3(0, NOSE.tip + 0.03, NOSE.out - 0.04);
    const bridge = MeshBuilder.CreateCylinder(
      `sahur-part-${id}`,
      { diameterTop: 0.07, diameterBottom: 0.1, height: Vector3.Distance(from, to), tessellation: 10 },
      scene,
    );
    bridge.position.copyFrom(from.add(to).scale(0.5));
    bridge.rotation.x = -Math.atan2(to.z - from.z, from.y - to.y); // lay the cylinder along from → to
    add(bridge, skin);
    ball(skin, new Vector3(0, NOSE.tip, NOSE.out - 0.05), new Vector3(0.065, 0.06, 0.06));
    for (const side of [-1, 1])
      ball(skin, new Vector3(side * 0.06, NOSE.tip - 0.01, PLATE.front + 0.04), new Vector3(0.045, 0.04, 0.04));

    // Cheekbones: jutting out under the outer corners of the eyes, to the log's own sides.
    for (const side of [-1, 1])
      ball(
        skin,
        new Vector3(side * 0.25, EYE.y - 0.25, PLATE.front - 0.07),
        new Vector3(0.12, 0.1, 0.1),
        new Vector3(0, 0, side * 0.3),
      );

    // Mouth: a wide smile, its corners up into the cheeks, a shadowed line between an upper lip and a
    // fuller lower one, and a chin under it.
    const smile = (half: number, y: number, lift: number, proud: number) =>
      Array.from({ length: 13 }, (_, i) => {
        const u = -1 + (2 * i) / 12;
        return new Vector3(u * half, y + lift * u * u, PLATE.front + proud * (1 - 0.5 * u * u));
      });
    tube(shade, smile(0.22, MOUTH_Y, 0.07, 0.012), 0.014);
    tube(skin, smile(0.19, MOUTH_Y + 0.028, 0.06, 0.004), 0.02);
    tube(skin, smile(0.16, MOUTH_Y - 0.035, 0.05, 0.008), 0.03);
    ball(skin, new Vector3(0, PLATE.bottom + 0.03, PLATE.front - 0.04), new Vector3(0.15, 0.07, 0.06));

    for (const [mat, meshes] of parts) {
      const merged = Mesh.MergeMeshes(meshes, true, true)!;
      merged.name = `sahur-${mat.name}`;
      merged.material = mat;
      merged.parent = this.log;
      merged.isPickable = false;
      if (mat === skin) paintSkin(merged);
    }

    // Limbs: tapered rods jointed at the elbow or knee, pivoting at the top.
    const limb = (
      name: string,
      parent: TransformNode,
      at: Vector3,
      upper: number,
      lower: number,
      radius: number,
    ): Limb => {
      const top = new TransformNode(`${name}-top`, scene);
      top.parent = parent;
      top.position.copyFrom(at);
      rod(scene, `${name}-upper`, top, limbMat, upper, radius, radius * 0.85);
      const joint = new TransformNode(`${name}-joint`, scene);
      joint.parent = top;
      joint.position.y = -upper;
      knob(scene, `${name}-knob`, joint, limbMat, radius * 0.95);
      rod(scene, `${name}-lower`, joint, limbMat, lower, radius * 0.85, radius * 0.7);
      const end = new TransformNode(`${name}-end`, scene);
      end.parent = joint;
      end.position.y = -lower;
      return { top, joint, end };
    };
    this.legL = limb(`sahur-legL-${id}`, this.body, new Vector3(-0.2, HIP + 0.03, 0), THIGH, SHIN, 0.06);
    this.legR = limb(`sahur-legR-${id}`, this.body, new Vector3(0.2, HIP + 0.03, 0), THIGH, SHIN, 0.06);
    for (const [side, leg] of [
      [-1, this.legL],
      [1, this.legR],
    ] as const)
      bigFoot(scene, `${leg.top.name}-foot`, leg.end, limbMat, side);

    this.armL = limb(
      `sahur-armL-${id}`,
      this.log,
      new Vector3(-SHOULDER.x, SHOULDER.y, 0.03),
      UPPER_ARM,
      FOREARM,
      0.04,
    );
    this.armR = limb(`sahur-armR-${id}`, this.log, new Vector3(SHOULDER.x, SHOULDER.y, 0.03), UPPER_ARM, FOREARM, 0.04);
    for (const [side, arm] of [
      [-1, this.armL],
      [1, this.armR],
    ] as const) {
      arm.top.rotation.z = side * 0.06; // hanging just clear of the log
      knob(scene, `${arm.top.name}-hand`, arm.end, limbMat, 0.055);
    }

    // The bat: gripped in the right hand, its barrel out in front and down to the ground.
    this.bat = new TransformNode(`sahur-bat-${id}`, scene);
    this.bat.parent = this.armR.end;
    this.bat.rotation.set(-0.62, 0, 0.12);
    const club = MeshBuilder.CreateCylinder(
      `sahur-bat-club-${id}`,
      { diameterTop: 0.06, diameterBottom: 0.17, height: 1.25, tessellation: 14 },
      scene,
    );
    club.material = batMat;
    club.parent = this.bat;
    club.position.y = -0.58;
    club.isPickable = false;

    // A held item goes in the right hand instead of the bat; the flamethrower's tank rides on the back.
    this.items = new HeldItems(
      engine,
      `sahur-${id}`,
      this.armR.end,
      new Vector3(0, -0.03, 0.04),
      this.log,
      new Vector3(0, SHOULDER.y, -(HALF_D + 0.1)),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.3);
    this.shadow.parent = this.root;
    this.shadow.position.y = 0.02;

    const tag = createTag(engine, id, name, color);
    tag.parent = this.root;
    tag.position.y = HEIGHT + 0.4;
  }

  update(p: RemotePlayer): void {
    this.hitFlash.update();
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const feetY = p.y - 1.7;
    const airborne = !p.grounded;
    this.root.position.set(p.x, feetY, p.z);
    this.root.rotation.y = p.yaw;

    // Stilted walk: stiff thighs swing from the hip, a knee bends only as its leg swings back, and
    // the log bobs; the arms keep hanging.
    if (moved > 0.002 && !airborne) this.phase += moved * 3.6;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const swing = airborne ? 0.2 : Math.sin(this.phase) * 0.34 * effort;
    this.legL.top.rotation.x = swing;
    this.legR.top.rotation.x = -swing;
    this.legL.joint.rotation.x = 0.04 + Math.max(0, -swing) * 0.9;
    this.legR.joint.rotation.x = 0.04 + Math.max(0, swing) * 0.9;
    this.log.position.y = HIP + (airborne ? 0 : Math.abs(Math.sin(this.phase)) * 0.05 * effort);

    // The log leans a little with the look and sways slowly; every few seconds, a short jerk sideways.
    const now = performance.now();
    const sinceTwitch = (now + this.twitchOffset) % TWITCH_EVERY_MS;
    const twitch = sinceTwitch < 140 ? Math.sin((sinceTwitch / 140) * Math.PI) * 0.12 : 0;
    this.log.rotation.set(p.pitch * 0.12, 0, Math.sin(now / 1700 + this.twitchOffset) * 0.03 + twitch);

    // Arms hang with soft elbows; the right one raises a held item instead of trailing the bat.
    const dangle = Math.sin(this.phase) * 0.04 * effort;
    this.armL.top.rotation.x = dangle;
    this.armL.joint.rotation.x = -0.15;
    this.armR.top.rotation.x = p.item ? -Math.PI / 2 + p.pitch : -dangle;
    this.armR.joint.rotation.x = p.item ? 0 : -0.15;
    this.bat.setEnabled(!p.item);
    this.items.update(p.item, p.firing);

    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Fallen flat on its back like a felled log, face to the sky, lifted by its half-depth to lie
      // on the ground rather than through it.
      this.body.rotation.x = p.dead ? -Math.PI / 2 : 0;
      this.body.position.y = p.dead ? HALF_D : 0;
    }
    if (p.dead) {
      for (const leg of [this.legL, this.legR]) leg.top.rotation.x = leg.joint.rotation.x = 0;
      this.log.rotation.set(0, 0, 0);
      this.log.position.y = HIP;
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

// A block from y0 to y1, `hw` wide and `hd` deep either side of its centre line, square-ish in
// section with rounded corners (a superellipse) and a rim rounded over `bevel` metres top and bottom.
function roundedBlock(
  scene: Engine['scene'],
  name: string,
  y0: number,
  y1: number,
  hw: number,
  hd: number,
  bevel: number,
): Mesh {
  const b = bevel / Math.min(hw, hd); // the bevel as a fraction of the unit lathe's radius
  const shape = [new Vector3(0, y0, 0)];
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    shape.push(new Vector3(1 - b + b * Math.sin(a), y0 + bevel - bevel * Math.cos(a), 0));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    shape.push(new Vector3(1 - b + b * Math.cos(a), y1 - bevel + bevel * Math.sin(a), 0));
  }
  shape.push(new Vector3(0, y1, 0));
  const m = MeshBuilder.CreateLathe(name, { shape, tessellation: 32, updatable: true }, scene);
  // The lathe is round with radius 1; stretch each ring onto a rounded rectangle.
  const positions = m.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 2]);
    if (r < 1e-6) continue;
    const c = positions[i] / r;
    const s = positions[i + 2] / r;
    const k = Math.pow(c ** 4 + s ** 4, -0.25); // the squircle's radius at that angle
    positions[i] = r * k * c * hw;
    positions[i + 2] = r * k * s * hd;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, positions);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, m.getIndices(), normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  return m;
}

// Colours a merged skin mesh by height up the log: SKIN, interpolated.
function paintSkin(m: Mesh): void {
  const positions = m.getVerticesData(VertexBuffer.PositionKind)!;
  const colors: number[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const t = Math.max(0, Math.min(1, positions[i + 1] / LOG));
    let k = 1;
    while (k < SKIN.length - 1 && SKIN[k].t < t) k++;
    const a = SKIN[k - 1];
    const b = SKIN[k];
    const c = Color3.Lerp(a.c, b.c, (t - a.t) / (b.t - a.t));
    colors.push(c.r, c.g, c.b, 1);
  }
  m.setVerticesData(VertexBuffer.ColorKind, colors);
}

// A limb segment: a tapered cylinder hanging down from its pivot.
function rod(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  length: number,
  top: number,
  bottom: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(
    name,
    { diameterTop: top * 2, diameterBottom: bottom * 2, height: length, tessellation: 10 },
    scene,
  );
  m.material = mat;
  m.parent = parent;
  m.position.y = -length / 2;
  m.isPickable = false;
  return m;
}

// A round joint, hand or knob at a pivot.
function knob(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  radius: number,
): Mesh {
  const m = MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 8 }, scene);
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// A big flat foot, long and turned a little outward, with a row of toes across its front.
function bigFoot(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  side: number,
): void {
  const foot = new TransformNode(name, scene);
  foot.parent = parent;
  foot.rotation.y = side * 0.25;
  const sole = MeshBuilder.CreateSphere(`${name}-sole`, { diameter: 2, segments: 10 }, scene);
  sole.material = mat;
  sole.parent = foot;
  sole.scaling.set(0.1, 0.05, 0.22);
  sole.position.set(0, 0.04, 0.1);
  sole.isPickable = false;
  for (let i = 0; i < 5; i++) {
    const toe = MeshBuilder.CreateSphere(`${name}-toe-${i}`, { diameter: 2, segments: 6 }, scene);
    toe.material = mat;
    toe.parent = foot;
    const big = i === (side < 0 ? 4 : 0) ? 1.4 : 1; // the big toe on the inside
    toe.scaling.set(0.028 * big, 0.024 * big, 0.03 * big);
    toe.position.set((i - 2) * 0.038, 0.025, 0.31 - Math.abs(i - 2) * 0.015);
    toe.isPickable = false;
  }
}
