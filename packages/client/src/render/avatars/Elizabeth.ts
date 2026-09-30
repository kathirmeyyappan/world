// Elizabeth (Gintama): a big white pear-shaped body with no neck, round eyes with three lashes
// each, a flat orange beak, two small flippers and orange webbed feet. Low-poly flat-shaded
// spheres for the body so it reads as a soft egg while still fitting the blocky world. Same
// movement, hit capsule and items as everyone else; a weapon goes in the right flipper.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { RemotePlayer } from '../../net/Interpolation';
import type { Engine } from '../Engine';
import { box, centreOf, createShadowBlob, createTag, flat, placeShadow, type Avatar } from './common';
import { HeldItems } from './HeldItems';
import { HitFlash } from './HitFlash';

const HEIGHT = 2.0;
const RADIUS = 0.62; // body is this wide all the way up until the dome
const DOME_FROM = 0.6; // fraction of the height where the top starts rounding
const EYE_Y = 1.62;
const BEAK_Y = 1.4;

export class ElizabethAvatar implements Avatar {
  readonly kind = 'elizabeth' as const;
  private readonly root: TransformNode;
  private readonly body: TransformNode;
  private readonly flipperL: Mesh;
  private readonly flipperR: Mesh;
  private readonly footL: Mesh;
  private readonly footR: Mesh;
  private readonly shadow: Mesh;
  private readonly items: HeldItems;
  private readonly hitFlash: HitFlash;
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
    this.root = new TransformNode(`avatar-${id}`, scene);
    this.body = new TransformNode(`avatar-body-${id}`, scene);
    this.body.parent = this.root;

    const white = flat(scene, `eliz-white-${id}`, new Color3(0.97, 0.96, 0.98), 0.55);
    const black = flat(scene, `eliz-black-${id}`, new Color3(0.03, 0.03, 0.04), 0);
    const orange = flat(scene, `eliz-orange-${id}`, new Color3(0.98, 0.66, 0.16), 0.22);
    const orangeDark = flat(scene, `eliz-orange-dark-${id}`, new Color3(0.72, 0.42, 0.06), 0.08);

    this.hitFlash = new HitFlash([white, orange]);

    // Body: a capsule, straight-sided, rounding into a dome from DOME_FROM up.
    capsule(scene, `eliz-body-${id}`, this.body, white);

    // Eyes: black ring, white iris, small pupil, three lashes fanning up and out.
    for (const side of [-1, 1]) {
      // Small, far apart, simple: a thin ring, white, a dot.
      const x = side * 0.205;
      disc(scene, `eliz-eye-ring-${side}-${id}`, this.body, black, 0.21, x, EYE_Y, RADIUS - 0.02);
      disc(scene, `eliz-eye-${side}-${id}`, this.body, white, 0.172, x, EYE_Y, RADIUS - 0.005);
      const pupil = box(scene, `eliz-pupil-${side}-${id}`, 0.04, 0.04, 0.02, black, this.body);
      pupil.position.set(x, EYE_Y, RADIUS + 0.01);
      for (const [i, off] of [-0.06, 0, 0.06].entries()) {
        const lash = box(scene, `eliz-lash-${side}-${i}-${id}`, 0.016, 0.06, 0.02, black, this.body);
        lash.position.set(x + off * 1.3, EYE_Y + 0.14 - Math.abs(off) * 0.3, RADIUS - 0.02);
        lash.rotation.z = -off * 6; // outer lashes fan outward
      }
    }

    // Beak: a flattened oval about half the face wide, with a darker orange line round its middle for
    // the mouth. The line is a thin disc a few percent wider than the beak, so only its rim
    // shows, wrapping the surface like a drawn line.
    const BEAK_SIZE = new Vector3(0.46, 0.27, 0.4);
    const beakAt = new Vector3(0, BEAK_Y, RADIUS + 0.08);
    const beak = MeshBuilder.CreateSphere(`eliz-beak-${id}`, { diameter: 1, segments: 6 }, scene);
    beak.convertToFlatShadedMesh();
    beak.material = orange;
    beak.parent = this.body;
    beak.scaling.copyFrom(BEAK_SIZE);
    beak.position.copyFrom(beakAt);
    beak.isPickable = false;
    const mouth = MeshBuilder.CreateCylinder(
      `eliz-beak-mouth-${id}`,
      { diameter: 1, height: 1, tessellation: 16 },
      scene,
    );
    mouth.material = orangeDark;
    mouth.parent = this.body;
    mouth.scaling.set(BEAK_SIZE.x * 1.04, 0.018, BEAK_SIZE.z * 1.04);
    mouth.position.set(beakAt.x, beakAt.y - 0.01, beakAt.z);
    mouth.isPickable = false;

    // Flippers: short flat paddles hanging from the shoulders, pivot at the top.
    this.flipperL = box(scene, `eliz-flipperL-${id}`, 0.11, 0.58, 0.3, white, this.body);
    this.flipperR = box(scene, `eliz-flipperR-${id}`, 0.11, 0.58, 0.3, white, this.body);
    this.flipperL.position.set(-(RADIUS + 0.04), 1.0, 0.05);
    this.flipperR.position.set(RADIUS + 0.04, 1.0, 0.05);
    this.flipperL.setPivotPoint(new Vector3(0, 0.29, 0));
    this.flipperR.setPivotPoint(new Vector3(0, 0.29, 0));
    this.flipperL.rotation.z = -0.3;
    this.flipperR.rotation.z = 0.3;

    // Feet: flat orange slabs with three toes each, poking out from under the body.
    this.footL = foot(scene, `eliz-footL-${id}`, this.body, orange, -0.24);
    this.footR = foot(scene, `eliz-footR-${id}`, this.body, orange, 0.24);

    // Items hang off the right flipper's tip; the flipper points forward while holding one. The
    // flamethrower's tank rides on the back of the egg.
    this.items = new HeldItems(
      engine,
      `eliz-${id}`,
      this.flipperR,
      new Vector3(0.02, -0.32, 0.04),
      this.body,
      new Vector3(0, 1.15, -(RADIUS + 0.1)),
    );

    this.shadow = createShadowBlob(engine, `avatar-shadow-${id}`, 1.5);
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

    // Waddle: rock side to side and lift alternate feet, scaled by how fast they're going.
    if (moved > 0.002 && !airborne) this.phase += moved * 5;
    const effort = airborne ? 0 : Math.min(1, moved * 60);
    const sway = Math.sin(this.phase) * 0.09 * effort;
    this.body.rotation.z = sway;
    this.body.rotation.x = p.pitch * 0.25;
    this.footL.position.y = 0.03 + Math.max(0, Math.sin(this.phase)) * 0.09 * effort;
    this.footR.position.y = 0.03 + Math.max(0, -Math.sin(this.phase)) * 0.09 * effort;
    this.flipperL.rotation.x = -Math.sin(this.phase) * 0.3 * effort;
    this.flipperR.rotation.x = p.item ? -Math.PI / 2 + p.pitch : Math.sin(this.phase) * 0.3 * effort;
    this.flipperR.rotation.z = p.item ? 0 : 0.3;

    this.items.update(p.item, p.firing);
    if (p.dead !== this.dead) {
      this.dead = p.dead;
      // Tipped onto its side; the egg's half-width keeps it resting on the ground.
      this.body.position.set(p.dead ? 1.0 : 0, p.dead ? RADIUS : 0, 0);
    }
    if (p.dead) {
      this.body.rotation.set(0, 0, Math.PI / 2);
      this.footL.position.y = this.footR.position.y = 0.03;
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

// The body as a lathe: a slightly rounded base, straight sides, and a dome for the top part.
// Flat shaded so it stays low-poly like everything else.
function capsule(scene: Engine['scene'], name: string, parent: TransformNode, mat: StandardMaterial): Mesh {
  const domeStart = HEIGHT * DOME_FROM;
  const shape = [
    new Vector3(0, 0, 0),
    new Vector3(RADIUS * 0.8, 0, 0),
    new Vector3(RADIUS, 0.1, 0),
    new Vector3(RADIUS, domeStart, 0),
  ];
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    shape.push(new Vector3(RADIUS * Math.cos(a), domeStart + (HEIGHT - domeStart) * Math.sin(a), 0));
  }
  const m = MeshBuilder.CreateLathe(name, { shape, tessellation: 14, sideOrientation: Mesh.DOUBLESIDE }, scene);
  m.convertToFlatShadedMesh();
  m.material = mat;
  m.parent = parent;
  m.isPickable = false;
  return m;
}

// A thin disc facing +z, for the eyes.
function disc(
  scene: Engine['scene'],
  name: string,
  parent: TransformNode,
  mat: StandardMaterial,
  diameter: number,
  x: number,
  y: number,
  z: number,
): Mesh {
  const m = MeshBuilder.CreateCylinder(name, { diameter, height: 0.02, tessellation: 10 }, scene);
  m.rotation.x = Math.PI / 2;
  m.material = mat;
  m.parent = parent;
  m.position.set(x, y, z);
  m.isPickable = false;
  return m;
}

function foot(scene: Engine['scene'], name: string, parent: TransformNode, mat: StandardMaterial, x: number): Mesh {
  const sole = box(scene, name, 0.3, 0.06, 0.34, mat, parent);
  sole.position.set(x, 0.03, 0.42); // poking out from under the front of the body
  for (const [i, tx] of [-0.1, 0, 0.1].entries()) {
    const toe = box(scene, `${name}-toe-${i}`, 0.07, 0.05, 0.14, mat, sole);
    toe.position.set(tx, 0, 0.22);
  }
  return sole;
}
