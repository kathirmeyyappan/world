import { Vector2 } from '@babylonjs/core';
import { UISystem } from '../systems/UISystem';

export interface InputState {
  movement: Vector2;
  lookDelta: Vector2;
  isPointerLocked: boolean;
}

/**
 * Unified input handling for keyboard, mouse, and touch.
 */
export class InputManager {
  private canvas: HTMLCanvasElement;
  private uiSystem: UISystem;
  private keys: Set<string> = new Set();
  private _lookDelta: Vector2 = Vector2.Zero();
  private _isPointerLocked: boolean = false;
  private isDragging: boolean = false;
  private lastPointerPos: Vector2 = Vector2.Zero();
  private _jumpRequested: boolean = false;

  // Mobile joystick state (set by mobile controls)
  public joystickMovement: Vector2 = Vector2.Zero();

  constructor(canvas: HTMLCanvasElement, uiSystem: UISystem) {
    this.canvas = canvas;
    this.uiSystem = uiSystem;
    this.setupKeyboardListeners();
    this.setupMouseListeners();
    this.setupTouchListeners();
  }

  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      // Don't process game input when overlay is visible (except for overlay close keys handled by UISystem)
      if (this.uiSystem.isVisible()) {
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this._jumpRequested = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      // Don't process game input when overlay is visible
      if (this.uiSystem.isVisible()) {
        return;
      }
      this.keys.delete(e.code);
    });
  }

  private setupMouseListeners(): void {
    this.canvas.addEventListener('click', () => {
      // Don't request pointer lock when overlay is visible
      if (!this._isPointerLocked && !this.uiSystem.isVisible()) {
        this.canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this._isPointerLocked = document.pointerLockElement === this.canvas;
    });

    document.addEventListener('mousemove', (e) => {
      // Don't process look input when overlay is visible
      if (this._isPointerLocked && !this.uiSystem.isVisible()) {
        this._lookDelta.x += e.movementX;
        this._lookDelta.y += e.movementY;
      }
    });

    // Fallback drag-to-look for when pointer lock isn't available
    this.canvas.addEventListener('mousedown', (e) => {
      // Don't start dragging when overlay is visible
      if (!this._isPointerLocked && e.button === 0 && !this.uiSystem.isVisible()) {
        this.isDragging = true;
        this.lastPointerPos.set(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      // Don't process drag-to-look when overlay is visible
      if (this.isDragging && !this._isPointerLocked && !this.uiSystem.isVisible()) {
        this._lookDelta.x += e.clientX - this.lastPointerPos.x;
        this._lookDelta.y += e.clientY - this.lastPointerPos.y;
        this.lastPointerPos.set(e.clientX, e.clientY);
      }
    });
  }

  private setupTouchListeners(): void {
    let touchId: number | null = null;

    this.canvas.addEventListener('touchstart', (e) => {
      // Use the first touch that's not on the joystick area
      for (const touch of Array.from(e.touches)) {
        if (touch.clientX > window.innerWidth * 0.3) {
          touchId = touch.identifier;
          this.lastPointerPos.set(touch.clientX, touch.clientY);
          break;
        }
      }
    });

    this.canvas.addEventListener('touchmove', (e) => {
      for (const touch of Array.from(e.touches)) {
        if (touch.identifier === touchId) {
          this._lookDelta.x += touch.clientX - this.lastPointerPos.x;
          this._lookDelta.y += touch.clientY - this.lastPointerPos.y;
          this.lastPointerPos.set(touch.clientX, touch.clientY);
          break;
        }
      }
    });

    this.canvas.addEventListener('touchend', (e) => {
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === touchId) {
          touchId = null;
          break;
        }
      }
    });
  }

  public getMovement(): Vector2 {
    // Don't return movement when overlay is visible
    if (this.uiSystem.isVisible()) {
      return Vector2.Zero();
    }

    const movement = new Vector2(0, 0);

    // Keyboard input
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) movement.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) movement.y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) movement.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) movement.x += 1;

    // Add joystick input
    movement.x += this.joystickMovement.x;
    movement.y += this.joystickMovement.y;

    // Normalize if magnitude > 1
    const length = movement.length();
    if (length > 1) {
      movement.scaleInPlace(1 / length);
    }

    return movement;
  }

  public getLookDelta(): Vector2 {
    // Don't return look delta when overlay is visible
    const delta = this._lookDelta.clone();
    if (this.uiSystem.isVisible()) {
      this._lookDelta.set(0, 0);
      return Vector2.Zero();
    }
    this._lookDelta.set(0, 0);
    return delta;
  }

  public get isPointerLocked(): boolean {
    return this._isPointerLocked;
  }

  public consumeJump(): boolean {
    // Don't allow jump when overlay is visible
    if (this.uiSystem.isVisible()) {
      this._jumpRequested = false;
      return false;
    }
    const jump = this._jumpRequested;
    this._jumpRequested = false;
    return jump;
  }

  public requestJump(): void {
    this._jumpRequested = true;
  }

  public update(): void {
    // Reserved for future per-frame input processing
  }
}

