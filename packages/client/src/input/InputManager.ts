// Collects keyboard, mouse, touch and joystick input into a per-tick InputFrame.
// Look (yaw/pitch) is integrated here every frame; movement and jump are sampled per tick.
import { MAX_PITCH, type InputFrame, type ItemAction } from '@world/shared';

const LOOK_SENSITIVITY = 0.002;
const TOUCH_LOOK_MULTIPLIER = 3; // a thumb travels far fewer pixels than a mouse
// Chrome can report one enormous movementX/Y right after the pointer locks (the distance the
// cursor travelled while unlocked, or a synthetic jump), which reads as the view snapping to a
// random direction. Motion inside this window after a lock change is dropped, and any single
// event past this many pixels is treated as such a glitch, not a flick.
const LOCK_SETTLE_MS = 150;
const MAX_EVENT_MOTION = 400;

export class InputManager {
  yaw = 0;
  pitch = 0;
  lookScale = 1; // <1 while scoped
  joystick = { x: 0, y: 0 };
  pointerLocked = false;
  fireHeld = false; // mouse button while the pointer is locked, or the touch FIRE button

  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>(); // keys that went down since the last sample
  private lookDx = 0;
  private lookDy = 0;
  private jumpRequested = false;
  private blocked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private lockChangedAt = -Infinity;

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (this.blocked || isTyping(e)) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space') this.jumpRequested = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.blocked && !this.pointerLocked) canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.lockChangedAt = performance.now();
    });
    // Pointer events, not mouse events: Babylon preventDefaults every canvas pointerdown, which
    // suppresses the compatibility mousedown/mousemove/mouseup while a button is held (always in
    // Firefox, unlocked in Chrome). Touch has its own handlers below.
    document.addEventListener('pointermove', (e) => {
      if (this.blocked || e.pointerType === 'touch') return;
      if (this.pointerLocked) {
        const sinceLock = performance.now() - this.lockChangedAt;
        const spike = Math.abs(e.movementX) > MAX_EVENT_MOTION || Math.abs(e.movementY) > MAX_EVENT_MOTION;
        if (sinceLock < LOCK_SETTLE_MS || spike) {
          if (spike)
            console.warn(
              `look: dropped a ${e.movementX},${e.movementY} px jump ${Math.round(sinceLock)} ms after pointer lock`,
            );
          return;
        }
        this.lookDx += e.movementX;
        this.lookDy += e.movementY;
      } else if (this.dragging) {
        this.lookDx += e.clientX - this.lastX;
        this.lookDy += e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.blocked || e.pointerType === 'touch') return;
      if (this.pointerLocked) this.fireHeld = true;
      else {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return; // the touch FIRE button owns fireHeld on touch
      this.dragging = false;
      this.fireHeld = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

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
      this.pressed.clear();
      this.fireHeld = false;
      this.jumpRequested = false;
      this.lookDx = this.lookDy = 0;
      this.dragging = false;
    }
  }

  requestJump(): void {
    if (!this.blocked) this.jumpRequested = true;
  }

  // The touch jump button: holding it holds the jump key (Space) down, for gear used by holding jump.
  holdJump(held: boolean): void {
    if (held && !this.blocked) this.keys.add('Space');
    else this.keys.delete('Space');
  }

  // Once per rendered frame: fold accumulated mouse motion into the view angles.
  update(): void {
    const k = LOOK_SENSITIVITY * this.lookScale;
    this.yaw += this.lookDx * k;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch + this.lookDy * k));
    this.lookDx = this.lookDy = 0;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  // Whether the key went down since the last sample, so a tap shorter than a tick still counts.
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  // Once per sim tick: everything the server needs to move us, plus the item actions in play.
  sampleFrame(seq: number, reading: string | null, actions: ItemAction[], view?: number): InputFrame {
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
    this.pressed.clear();
    return { seq, mx, my, yaw: this.yaw, pitch: this.pitch, jump, reading, actions, view };
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}
