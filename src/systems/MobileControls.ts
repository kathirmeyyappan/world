import { Vector2 } from '@babylonjs/core';
import { InputManager } from '../core/InputManager';
import nipplejs from 'nipplejs';

/**
 * Handles mobile-specific controls including virtual joystick.
 */
export class MobileControls {
  private inputManager: InputManager;
  private joystickManager: nipplejs.JoystickManager | null = null;
  private jumpButton: HTMLElement | null = null;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
    
    if (this.isMobileDevice()) {
      this.setupJoystick();
      this.setupJumpButton();
    }
  }

  private isMobileDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  private setupJoystick(): void {
    const zone = document.getElementById('joystick-zone');
    if (!zone) return;

    this.joystickManager = nipplejs.create({
      zone: zone,
      mode: 'static',
      position: { left: '60px', bottom: '60px' },
      color: 'rgba(255, 255, 255, 0.3)',
      size: 100,
    });

    this.joystickManager.on('move', (_, data) => {
      if (data.vector) {
        // nipplejs gives x/y where y is up, we need to flip for our coordinate system
        this.inputManager.joystickMovement = new Vector2(
          data.vector.x,
          data.vector.y
        );
      }
    });

    this.joystickManager.on('end', () => {
      this.inputManager.joystickMovement = Vector2.Zero();
    });
  }

  private setupJumpButton(): void {
    this.jumpButton = document.getElementById('jump-button');
    if (!this.jumpButton) return;

    this.jumpButton.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.inputManager.requestJump();
    });
  }

  public dispose(): void {
    if (this.joystickManager) {
      this.joystickManager.destroy();
      this.joystickManager = null;
    }
  }
}

