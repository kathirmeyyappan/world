// Pictures the browser draws itself, at full screen resolution, in a layer under the 3D canvas,
// each lined up with a flat panel in the scene. The 3D view renders at a fraction of the screen's
// resolution (Engine's PIXEL_SCALE), which is the look everywhere else but turns small text to
// mush; this is for what has to stay sharp, like a widget's text.
//
// A panel's mesh writes depth but no colour and is drawn before everything else, and the scene
// clears to transparent (the sky covers the rest), so the canvas stays see-through exactly where
// the panel is and nothing nearer covers it: walls and players hide a panel like any surface. The
// pictures are plain canvases the page has already drawn, so moving them each frame is only the
// browser placing a texture; they're repainted only when their source changes.
import { Color4, Frustum, Matrix, StandardMaterial, Vector3, type AbstractMesh, type Camera } from '@babylonjs/core';
import type { FramePanel } from '@world/shared';
import type { Engine } from './Engine';

const CSS_PX_PER_M = 100; // the scale view space is put into before CSS's perspective divide

interface Panel {
  el: HTMLCanvasElement;
  toWorld: Matrix; // the element's CSS pixels (from its top-left, y down) to world metres
  u: [number, number]; // the stretch of the source it shows, as fractions of its width
}

export class CrispPanels {
  private readonly layer = document.createElement('div');
  private readonly masks = new Set<AbstractMesh>();
  private readonly shown: { mask: AbstractMesh; panels: Panel[]; visible: boolean }[] = [];

  constructor(engine: Engine) {
    const scene = engine.scene;
    this.layer.id = 'crisp-panels';
    engine.engine.getRenderingCanvas()?.before(this.layer);
    scene.clearColor = new Color4(0, 0, 0, 0);
    const isMask = (m: AbstractMesh) => (this.masks.has(m) ? 1 : 0);
    // Masks first, so their depth holds back everything behind them; otherwise list order.
    scene.setRenderingOrder(0, (a, b) => isMask(b.getMesh()) - isMask(a.getMesh()));
  }

  // Show `source` across a frame's `panels` (its picture's layout, `u` running 0 to 1 across it),
  // cutting the hole with `mask`, the mesh of those panels. Returns what to call when `source` has
  // been drawn again.
  add(mask: AbstractMesh, panels: FramePanel[], source: HTMLCanvasElement): () => void {
    const mat = new StandardMaterial(`${mask.name}-hole`, mask.getScene());
    mat.disableColorWrite = true;
    mat.backFaceCulling = false;
    mask.material = mat;
    this.masks.add(mask);
    const slices = panels.map(({ corners: [bl, , tr, tl], u }) => {
      const el = document.createElement('canvas');
      el.width = Math.max(1, Math.round(source.width * (u[1] - u[0])));
      el.height = source.height;
      el.style.width = `${el.width}px`;
      el.style.height = `${el.height}px`;
      this.layer.append(el);
      // Across the element runs from tl to tr, and down it from tl to bl.
      const ax = (tr.x - tl.x) / el.width;
      const ay = (tr.y - tl.y) / el.width;
      const az = (tr.z - tl.z) / el.width;
      const dx = (bl.x - tl.x) / el.height;
      const dy = (bl.y - tl.y) / el.height;
      const dz = (bl.z - tl.z) / el.height;
      // Out of the element: any direction off its plane keeps the matrix invertible, which CSS needs.
      const n = Vector3.Cross(new Vector3(ax, ay, az), new Vector3(dx, dy, dz)).normalize();
      // prettier-ignore
      const toWorld = Matrix.FromValues(
        ax, ay, az, 0,
        dx, dy, dz, 0,
        n.x, n.y, n.z, 0,
        tl.x, tl.y, tl.z, 1,
      );
      const slice: Panel = { el, toWorld, u };
      return slice;
    });
    this.shown.push({ mask, panels: slices, visible: true });
    const repaint = () => {
      for (const { el, u } of slices) {
        const ctx = el.getContext('2d')!;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(source, source.width * u[0], 0, el.width, el.height, 0, 0, el.width, el.height);
      }
    };
    repaint();
    return repaint;
  }

  // Put every panel where `camera` sees its mesh, and hide the ones out of view.
  update(camera: Camera): void {
    // CSS's perspective puts the eye this many pixels in front of the screen.
    const eye = this.layer.clientHeight / 2 / Math.tan(camera.fov / 2);
    this.layer.style.perspective = `${eye}px`;
    // View space (x right, y up, z ahead) to CSS's (y down, z toward the eye), the eye at `eye`.
    const toCss = Matrix.Scaling(CSS_PX_PER_M, -CSS_PX_PER_M, -CSS_PX_PER_M).multiply(Matrix.Translation(0, 0, eye));
    const view = camera.getViewMatrix().multiply(toCss);
    const frustum = Frustum.GetPlanes(camera.getTransformationMatrix());
    for (const frame of this.shown) {
      const visible = frame.mask.isInFrustum(frustum);
      if (visible !== frame.visible) {
        frame.visible = visible;
        for (const { el } of frame.panels) el.style.visibility = visible ? '' : 'hidden';
      }
      if (!visible) continue;
      for (const { el, toWorld } of frame.panels)
        el.style.transform = `matrix3d(${toWorld.multiply(view).m.join(',')})`;
    }
  }
}
