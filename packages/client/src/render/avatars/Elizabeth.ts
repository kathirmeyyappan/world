// Elizabeth (Gintama): a big white pear-shaped body with no neck, round eyes with three lashes
// each, a flat orange beak, two small flippers and orange webbed feet. Low-poly flat-shaded
// spheres for the body so it reads as a soft egg while still fitting the blocky world. It waddles,
// rocking side to side and lifting alternate feet, and tips onto its side when it dies. A wider hit
// capsule than everyone's (AVATARS.elizabeth.hitbox); a weapon goes in the right flipper.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import type { Engine } from '../Engine';
import { box, flat } from './common';
import type { Figure } from './Walker';

const HEIGHT = 2.0;
const RADIUS = 0.62; // body is this wide all the way up until the dome
const DOME_FROM = 0.6; // fraction of the height where the top starts rounding
const EYE_Y = 1.62;
const BEAK_Y = 1.4;
const FLIPPER_OUT = 0.3; // radians the flippers angle out from the body
const FOOT_LIFT = 0.09; // metres a foot comes up mid-step

export function buildElizabeth(engine: Engine, id: string, base: TransformNode): Figure {
  const scene = engine.scene;
  const white = flat(scene, `eliz-white-${id}`, new Color3(0.97, 0.96, 0.98), 0.55);
  const black = flat(scene, `eliz-black-${id}`, new Color3(0.03, 0.03, 0.04), 0);
  const orange = flat(scene, `eliz-orange-${id}`, new Color3(0.98, 0.66, 0.16), 0.22);
  const orangeDark = flat(scene, `eliz-orange-dark-${id}`, new Color3(0.72, 0.42, 0.06), 0.08);

  // Body: a capsule, straight-sided, rounding into a dome from DOME_FROM up.
  capsule(scene, `eliz-body-${id}`, base, white);

  // Eyes: black ring, white iris, small pupil, three lashes fanning up and out.
  for (const side of [-1, 1]) {
    // Small, far apart, simple: a thin ring, white, a dot.
    const x = side * 0.205;
    disc(scene, `eliz-eye-ring-${side}-${id}`, base, black, 0.21, x, EYE_Y, RADIUS - 0.02);
    disc(scene, `eliz-eye-${side}-${id}`, base, white, 0.172, x, EYE_Y, RADIUS - 0.005);
    const pupil = box(scene, `eliz-pupil-${side}-${id}`, 0.04, 0.04, 0.02, black, base);
    pupil.position.set(x, EYE_Y, RADIUS + 0.01);
    for (const [i, off] of [-0.06, 0, 0.06].entries()) {
      const lash = box(scene, `eliz-lash-${side}-${i}-${id}`, 0.016, 0.06, 0.02, black, base);
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
  beak.parent = base;
  beak.scaling.copyFrom(BEAK_SIZE);
  beak.position.copyFrom(beakAt);
  beak.isPickable = false;
  const mouth = MeshBuilder.CreateCylinder(
    `eliz-beak-mouth-${id}`,
    { diameter: 1, height: 1, tessellation: 16 },
    scene,
  );
  mouth.material = orangeDark;
  mouth.parent = base;
  mouth.scaling.set(BEAK_SIZE.x * 1.04, 0.018, BEAK_SIZE.z * 1.04);
  mouth.position.set(beakAt.x, beakAt.y - 0.01, beakAt.z);
  mouth.isPickable = false;

  // Flippers: short flat paddles hanging from the shoulders, pivot at the top.
  const flipperL = box(scene, `eliz-flipperL-${id}`, 0.11, 0.58, 0.3, white, base);
  const flipperR = box(scene, `eliz-flipperR-${id}`, 0.11, 0.58, 0.3, white, base);
  flipperL.position.set(-(RADIUS + 0.04), 1.0, 0.05);
  flipperR.position.set(RADIUS + 0.04, 1.0, 0.05);
  flipperL.setPivotPoint(new Vector3(0, 0.29, 0));
  flipperR.setPivotPoint(new Vector3(0, 0.29, 0));

  // Feet: flat orange slabs with three toes each, poking out from under the body.
  const footL = foot(scene, `eliz-footL-${id}`, base, orange, -0.24);
  const footR = foot(scene, `eliz-footR-${id}`, base, orange, 0.24);

  // Items hang off the right flipper's tip; the flamethrower's tank rides on the back of the egg.
  const grip = new TransformNode(`avatar-grip-${id}`, scene);
  grip.parent = flipperR;
  grip.position.set(0.02, -0.32, 0.04);

  return {
    tilt: { node: base, follow: 0.25 },
    armL: { node: flipperL, reach: Vector3.Down() },
    armR: { node: flipperR, grip, reach: Vector3.Down() },
    back: { node: base, at: new Vector3(0, 1.15, -(RADIUS + 0.1)) },
    materials: [white, orange],
    shadow: 1.5,
    legSwing: 0,
    airLegs: 0,
    armSwing: 0.3,
    armsDown: -FLIPPER_OUT,
    bob: 0,
    sway: 0.09,
    lie: { onto: 'left', height: RADIUS, shift: 1.0 }, // tipped onto its side; the egg's half-width keeps it resting on the ground
    // The waddle lifts alternate feet, scaled by how fast they're going; none on a ladder or dead.
    extra: (p, { phase, effort }) => {
      const lift = p.dead ? 0 : effort * FOOT_LIFT;
      footL.position.y = 0.03 + Math.max(0, Math.sin(phase)) * lift;
      footR.position.y = 0.03 + Math.max(0, -Math.sin(phase)) * lift;
    },
  };
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
