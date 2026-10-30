// Where the player sees from. First person is the avatar's own eyes. Third person (Z) is a camera on
// a boom behind its right shoulder that turns with the look, stays a fixed distance out and is
// pulled in short of any wall between it and the body. The crosshair keeps its meaning there by
// aiming the body: the look sent to the server, which is where its shot goes and where others see
// its head turned, is the direction from the eyes to whatever the camera's centre ray lands on, so
// what the crosshair is on is what gets hit. The boom goes out and comes back over a moment, at the
// pace the eyes rise when the look changes; the scope is always looked down from the eyes, at once.
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
const EASE = 0.25; // seconds the boom takes to go out or come in, as the eyes take to rise for a new look
const BODY_FROM = 0.35; // the way out past which the body is drawn: the camera is clear of the head
const STORAGE_KEY = 'world.view'; // the choice, kept for next time

export class View {
  mode: ViewMode = 'third';
  private reach = 0; // how far along its way out the boom is, 0 at the eyes to 1 at its length

  constructor() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'first') this.mode = 'first';
    } catch {
      // no storage: first person
    }
    this.reach = this.mode === 'third' ? 1 : 0;
  }

  toggle(): void {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    try {
      localStorage.setItem(STORAGE_KEY, this.mode);
    } catch {
      // not kept
    }
  }

  // Whether the camera is at the eyes this frame, where the first-person hands belong.
  get atEyes(): boolean {
    return this.reach === 0;
  }

  // Whether the player's own body is drawn: the camera is out past the shoulder.
  get showsBody(): boolean {
    return this.reach > BODY_FROM;
  }

  // Puts the camera for this frame: at `eyes` (less the head bob's `dip`) or out along the boom
  // behind them, scaled by `stature` and stopped short of `structures`, by how far it has got in
  // `dt` more seconds. Scoped, it is at the eyes at once. The look is the camera's rotation either
  // way, set by the Game.
  place(
    camera: UniversalCamera,
    eyes: Vector3,
    dip: number,
    yaw: number,
    pitch: number,
    stature: number,
    scoped: boolean,
    structures: Structures,
    dt: number,
  ): void {
    const target = this.mode === 'third' && !scoped ? 1 : 0;
    const step = Math.min(dt / EASE, Math.abs(target - this.reach));
    this.reach = scoped ? 0 : this.reach + (target > this.reach ? step : -step);
    if (this.reach === 0) {
      camera.position.set(eyes.x, eyes.y - dip, eyes.z);
      return;
    }
    const out = this.reach * this.reach * (3 - 2 * this.reach); // eased at both ends
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
    const along = Math.max(0, Math.min(span * out, structures.raycast(eyes, dir, span) - SKIN));
    camera.position.set(
      eyes.x + dir.x * along,
      Math.max(FLOOR, eyes.y + dir.y * along - dip * (1 - out)),
      eyes.z + dir.z * along,
    );
  }

  // The look to send: the camera's own at the eyes, else from the eyes to where the camera's centre
  // ray lands on a wall or another player, or CONVERGE_FAR out.
  aim(
    eyes: Vec3,
    camera: Vec3,
    yaw: number,
    pitch: number,
    selfId: string,
    targets: Iterable<Target>,
    structures: Structures,
  ): { yaw: number; pitch: number } {
    if (this.reach === 0) return { yaw, pitch };
    const d = lookDirection(yaw, pitch);
    const t = Math.max(CONVERGE_MIN, reach(camera, d, targets, CONVERGE_FAR, selfId, structures));
    const dx = camera.x + d.x * t - eyes.x;
    const dy = camera.y + d.y * t - eyes.y;
    const dz = camera.z + d.z * t - eyes.z;
    const aimed = -Math.atan2(dy, Math.hypot(dx, dz));
    return { yaw: Math.atan2(dx, dz), pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, aimed)) };
  }
}
