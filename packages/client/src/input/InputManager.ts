// Collects keyboard, mouse, touch and joystick input into a per-tick InputFrame.
// Look (yaw/pitch) is integrated here every frame; movement and jump are sampled per tick.
import { MAX_PITCH, type InputFrame } from '@world/shared';

const LOOK_SENSITIVITY = 0.002;
const TOUCH_LOOK_MULTIPLIER = 3; // a thumb travels far fewer pixels than a mouse

export class InputManager {
  yaw = 0;
  pitch = 0;
  joystick = { x: 0, y: 0 };
  pointerLocked = false;

  private readonly keys = new Set<string>();
  private lookDx = 0;
  private lookDy = 0;
  private jumpRequested = false;
  private blocked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.blocked || isTyping(e)) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpRequested = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.blocked && !this.pointerLocked) canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.blocked) return;
      if (this.pointerLocked) {
        this.lookDx += e.movementX;
        this.lookDy += e.movementY;
      } else if (this.dragging) {
        this.lookDx += e.clientX - this.lastX;
        this.lookDy += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked && e.button === 0 && !this.blocked) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => (this.dragging = false));

    let touchId: number | null = null;
    canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.touches)) {
        if (t.clientX > window.innerWidth * 0.3) {
          touchId = t.identifier;
          this.lastX = t.clientX;
          this.lastY = t.clientY;
          break;
        }
      }
    });
    canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.touches)) {
        if (t.identifier === touchId) {
          this.lookDx += (t.clientX - this.lastX) * TOUCH_LOOK_MULTIPLIER;
          this.lookDy += (t.clientY - this.lastY) * TOUCH_LOOK_MULTIPLIER;
          this.lastX = t.clientX;
          this.lastY = t.clientY;
        }
      }
    });
    canvas.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === touchId) touchId = null;
    });
  }

  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    if (blocked) {
      this.keys.clear();
      this.jumpRequested = false;
      this.lookDx = this.lookDy = 0;
      this.dragging = false;
    }
  }

  requestJump(): void {
    if (!this.blocked) this.jumpRequested = true;
  }

  // Once per rendered frame: fold accumulated mouse motion into the view angles.
  update(): void {
    this.yaw += this.lookDx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.lookDy * LOOK_SENSITIVITY));
    this.lookDx = this.lookDy = 0;
  }

  // Once per sim tick: everything the server needs to move us.
  sampleFrame(seq: number, reading: string | null): InputFrame {
    let mx = this.joystick.x;
    let my = this.joystick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const jump = this.jumpRequested;
    this.jumpRequested = false;
    return { seq, mx, my, yaw: this.yaw, pitch: this.pitch, jump, reading };
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
