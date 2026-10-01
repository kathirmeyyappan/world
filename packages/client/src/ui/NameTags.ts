// Remote players' names over their heads, as page text rather than in the 3D scene: the scene
// renders at a fraction of screen resolution for its pixel look, which turns a name more than a
// few metres off into a smudge. Each tag sits over the top of its avatar's body at the size it
// would have in the world (lettering TAG_EM metres tall, seen through the camera's field of
// view), kept between MIN_PX and MAX_PX, and hides while a structure stands between it and the
// camera. Off-screen players get a pin instead (Pins.ts).
import { Matrix, Vector3, type Camera, type Scene } from '@babylonjs/core';
import { AVATARS, EYE_HEIGHT, WORLD_STRUCTURES } from '@world/shared';
import type { RemotePlayer } from '../net/Interpolation';

const ABOVE_BODY = 0.3; // metres from the top of the body to the middle of the name
const TAG_EM = 0.23; // metres: the font size in the world, about 20 px at 6 m
const MIN_PX = 9; // far off, small but still sharp
const MAX_PX = 28;

// The element, and the font size and stacking last written to it (writes only on change).
interface Tag {
  el: HTMLDivElement;
  px: number;
  z: number;
}

export class NameTags {
  private readonly root = document.getElementById('name-tags')!;
  private readonly tags = new Map<string, Tag>();

  update(players: RemotePlayer[], scene: Scene, camera: Camera, canvas: HTMLCanvasElement): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const view = camera.getViewMatrix();
    const viewport = camera.viewport.toGlobal(w, h);
    const transform = scene.getTransformMatrix();
    const eye = camera.globalPosition;
    const pxPerMetreAt1m = h / (2 * Math.tan(camera.fov / 2)); // vertical field of view
    const seen = new Set<string>();

    for (const p of players) {
      seen.add(p.id);
      const tag = this.tags.get(p.id) ?? this.create(p);
      const at = new Vector3(p.x, p.y - EYE_HEIGHT + AVATARS[p.avatar].hitbox.top + ABOVE_BODY, p.z);
      const screen = Vector3.Project(at, Matrix.Identity(), transform, viewport);
      const visible =
        Vector3.TransformCoordinates(at, view).z > 0 &&
        screen.x >= 0 &&
        screen.x <= w &&
        screen.y >= 0 &&
        screen.y <= h &&
        WORLD_STRUCTURES.clear(eye, at);
      tag.el.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      const d = Vector3.Distance(eye, at);
      const px = Math.round(Math.min(MAX_PX, Math.max(MIN_PX, (TAG_EM * pxPerMetreAt1m) / d)));
      if (px !== tag.px) {
        tag.px = px;
        tag.el.style.fontSize = `${px}px`;
      }
      const z = Math.max(0, 1000 - Math.round(d)); // nearer names over farther ones
      if (z !== tag.z) {
        tag.z = z;
        tag.el.style.zIndex = String(z);
      }
      tag.el.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    }

    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.el.remove();
        this.tags.delete(id);
      }
    }
  }

  private create(p: RemotePlayer): Tag {
    const el = document.createElement('div');
    el.className = 'name-tag';
    el.textContent = p.name;
    el.style.color = p.color;
    this.root.appendChild(el);
    const tag = { el, px: 0, z: -1 };
    this.tags.set(p.id, tag);
    return tag;
  }
}
