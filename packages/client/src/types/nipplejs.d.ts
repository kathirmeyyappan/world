declare module 'nipplejs' {
  export interface JoystickManagerOptions {
    zone: HTMLElement;
    mode?: 'static' | 'semi' | 'dynamic';
    position?: { left?: string; right?: string; top?: string; bottom?: string };
    color?: string;
    size?: number;
    threshold?: number;
    fadeTime?: number;
    multitouch?: boolean;
    maxNumberOfNipples?: number;
    dataOnly?: boolean;
    restJoystick?: boolean;
    restOpacity?: number;
    lockX?: boolean;
    lockY?: boolean;
  }

  export interface JoystickOutputData {
    identifier: number;
    position: { x: number; y: number };
    force: number;
    pressure: number;
    distance: number;
    angle: {
      radian: number;
      degree: number;
    };
    vector: { x: number; y: number };
    raw: { x: number; y: number };
    instance: Joystick;
  }

  export interface Joystick {
    el: HTMLElement;
    id: number;
    identifier: number;
    position: { x: number; y: number };
    frontPosition: { x: number; y: number };
    ui: {
      el: HTMLElement;
      front: HTMLElement;
      back: HTMLElement;
    };
    options: JoystickManagerOptions;
  }

  export interface JoystickManager {
    on(
      event: 'start' | 'end' | 'move' | 'dir' | 'plain' | 'shown' | 'hidden' | 'destroyed',
      handler: (evt: unknown, data: JoystickOutputData) => void
    ): void;
    off(event: string, handler?: (...args: unknown[]) => void): void;
    destroy(): void;
    get(id: number): Joystick | undefined;
  }

  export function create(options: JoystickManagerOptions): JoystickManager;
}

