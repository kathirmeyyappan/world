// Off-screen indicators: a small arrow at the screen edge for each remote player who isn't in
// view, in their colour, with the horizontal distance. On-screen players get nothing; their name
// tag already marks them.
import { Matrix, Vector3, type Camera, type Scene } from '@babylonjs/core';
import type { RemotePlayer } from '../net/Interpolation';

const EDGE_MARGIN = 34;

interface Pin {
  el: HTMLDivElement;
  arrow: HTMLSpanElement;
  label: HTMLSpanElement;
}

export class Pins {
  private readonly root = document.getElementById('pins')!;
  private readonly pins = new Map<string, Pin>();

  update(players: RemotePlayer[], scene: Scene, camera: Camera, canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w / 2;
    const cy = h / 2;
    const view = camera.getViewMatrix();
    const viewport = camera.viewport.toGlobal(w, h);
    const transform = scene.getTransformMatrix();
    const seen = new Set<string>();

    for (const p of players) {
      seen.add(p.id);
      const world = new Vector3(p.x, p.y, p.z);
      const behind = Vector3.TransformCoordinates(world, view).z < 0;
      const screen = Vector3.Project(world, Matrix.Identity(), transform, viewport);
      let dx = screen.x - cx;
      let dy = screen.y - cy;
      if (behind) {
        dx = -dx;
        dy = -dy;
      }
      const onScreen = !behind && screen.x >= 0 && screen.x <= w && screen.y >= 0 && screen.y <= h;
      const pin = this.pins.get(p.id) ?? this.create(p);
      if (onScreen) {
        pin.el.style.display = 'none';
        continue;
      }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const t = Math.min((cx - EDGE_MARGIN) / Math.abs(dx || 1e-6), (cy - EDGE_MARGIN) / Math.abs(dy || 1e-6));
      const x = cx + dx * t;
      const y = cy + dy * t;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      pin.el.style.display = 'flex';
      pin.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      pin.arrow.style.transform = `rotate(${angle}deg)`;
      pin.label.textContent = `${Math.round(Math.hypot(p.x - camera.position.x, p.z - camera.position.z))}m`;
    }

    for (const [id, pin] of this.pins) {
      if (!seen.has(id)) {
        pin.el.remove();
        this.pins.delete(id);
      }
    }
  }

  private create(p: RemotePlayer): Pin {
    const el = document.createElement('div');
    el.className = 'pin';
    el.title = p.name;
    el.style.color = p.color;
    const arrow = document.createElement('span');
    arrow.className = 'pin-arrow';
    arrow.textContent = '▲';
    const label = document.createElement('span');
    label.className = 'pin-label';
    el.append(arrow, label);
    this.root.appendChild(el);
    const pin = { el, arrow, label };
    this.pins.set(p.id, pin);
    return pin;
  }
}
