import nipplejs from 'nipplejs';
import type { InputManager } from './InputManager';

export class MobileControls {
  private manager: nipplejs.JoystickManager | null = null;

  constructor(input: InputManager) {
    if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) return;
    const zone = document.getElementById('joystick-zone');
    if (zone) {
      this.manager = nipplejs.create({
        zone,
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'rgba(255, 255, 255, 0.3)',
        size: 100,
      });
      this.manager.on('move', (_, data) => {
        if (data.vector) input.joystick = { x: data.vector.x, y: data.vector.y };
      });
      this.manager.on('end', () => (input.joystick = { x: 0, y: 0 }));
    }
    document.getElementById('jump-button')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.requestJump();
    });
  }

  dispose(): void {
    this.manager?.destroy();
    this.manager = null;
  }
}
