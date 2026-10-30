// Where the player sees from. First person is the avatar's own eyes. Third person (Z) is a camera on
// a boom behind its right shoulder that turns with the look, stays a fixed distance out and is
// pulled in short of any wall between it and the body. The crosshair keeps its meaning there by
// aiming the body: the look sent to the server, which is where its shot goes and where others see
// its head turned, is the direction from the eyes to whatever the camera's centre ray lands on, so
// what the crosshair is on is what gets hit. The scope is always looked down from the eyes.
import { Vector3, type UniversalCamera } from '@babylonjs/core';
import { lookDirection, MAX_PITCH, reach, type Structures, type Target, type Vec3 } from '@world/shared';

export type ViewMode = 'first' | 'third';

// The boom, in metres for the standard body and in proportion for the rest: back from the eyes, out
// past the right shoulder, and up.
const BOOM_BACK = 3.4;
const BOOM_RIGHT = 0.6;
const BOOM_UP = 0.6;
const SKIN = 0.25; // metres the camera keeps off a wall the boom runs into
const FLOOR = 0.15; // metres the camera keeps above the ground when the boom dips under it
// The eyes aim at what the crosshair is on, or a point this far out when nothing is nearer, and no
// nearer than CONVERGE_MIN: the look sent is also what the movement keys are relative to, and a
// wall at the nose must not swing it round.
const CONVERGE_FAR = 60;
const CONVERGE_MIN = 5;
const STORAGE_KEY = 'world.view'; // the choice, kept for next time

export class View {
  mode: ViewMode = 'first';

  constructor() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'third') this.mode = 'third';
    } catch {
      // no storage: first person
    }
  }

  toggle(): void {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    try {
      localStorage.setItem(STORAGE_KEY, this.mode);
    } catch {
      // not kept
    }
  }

  // Whether the camera is on the boom this frame: the third-person choice, except down the scope.
  third(scoped: boolean): boolean {
    return this.mode === 'third' && !scoped;
  }

  // Puts the camera: at `eyes` (less the head bob's `dip`) in first person, or on the boom behind
  // them, scaled by `stature` and stopped short of `structures`. The look is the camera's rotation
  // either way, set by the Game.
  place(
    camera: UniversalCamera,
    eyes: Vector3,
    dip: number,
    yaw: number,
    pitch: number,
    stature: number,
    third: boolean,
    structures: Structures,
  ): void {
    if (!third) {
      camera.position.set(eyes.x, eyes.y - dip, eyes.z);
      return;
    }
    const f = lookDirection(yaw, pitch);
    const back = BOOM_BACK * stature;
    const right = BOOM_RIGHT * stature;
    const want = new Vector3(
      eyes.x - f.x * back + Math.cos(yaw) * right,
      eyes.y - f.y * back + BOOM_UP * stature,
      eyes.z - f.z * back - Math.sin(yaw) * right,
    );
    const span = Vector3.Distance(eyes, want);
    const dir = want.subtract(eyes).scaleInPlace(1 / span);
    const along = Math.max(0, Math.min(span, structures.raycast(eyes, dir, span) - SKIN));
    camera.position.set(eyes.x + dir.x * along, Math.max(FLOOR, eyes.y + dir.y * along), eyes.z + dir.z * along);
  }

  // The look to send from third person: from the eyes to where the camera's centre ray lands on a
  // wall or another player, or CONVERGE_FAR out.
  aim(
    eyes: Vec3,
    camera: Vec3,
    yaw: number,
    pitch: number,
    selfId: string,
    targets: Iterable<Target>,
    structures: Structures,
  ): { yaw: number; pitch: number } {
    const d = lookDirection(yaw, pitch);
    const t = Math.max(CONVERGE_MIN, reach(camera, d, targets, CONVERGE_FAR, selfId, structures));
    const dx = camera.x + d.x * t - eyes.x;
    const dy = camera.y + d.y * t - eyes.y;
    const dz = camera.z + d.z * t - eyes.z;
    const aimed = -Math.atan2(dy, Math.hypot(dx, dz));
    return { yaw: Math.atan2(dx, dz), pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, aimed)) };
  }
}
