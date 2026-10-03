// Pictures the browser draws itself, at full screen resolution, in a layer under the 3D canvas,
// each lined up with a flat panel in the scene. The 3D view renders at a fraction of the screen's
// resolution (Engine's PIXEL_SCALE), which is the look everywhere else but turns small text to
// mush; this is for what has to stay sharp, like the pictures on the tower's walls.
//
// A panel's mesh writes depth but no colour and is drawn before everything else, and the scene
// clears to transparent (the sky covers the rest), so the canvas stays see-through exactly where
// the panel is and nothing nearer covers it: walls and players hide a panel like any surface. The
// pictures are plain canvases the page has already drawn, so moving them each frame is only the
// browser placing a texture; they're repainted only when their source changes, and hidden (and
// whoever drew them told) while their mesh is out of the camera's view.
import { Color4, Frustum, Matrix, StandardMaterial, Vector3, type AbstractMesh, type Camera } from '@babylonjs/core';
import type { FramePanel } from '@world/shared';
import type { Engine } from './Engine';

const CSS_PX_PER_M = 100; // the scale view space is put into before CSS's perspective divide
const SCANLINE = 0.05; // metres between an old screen's scanlines, wherever it hangs

interface Panel {
  el: HTMLCanvasElement;
  toWorld: Matrix; // the element's CSS pixels (from its top-left, y down) to world metres
  u: [number, number]; // the stretch of the source it shows, as fractions of its width
}

interface Shown {
  mask: AbstractMesh;
  panels: Panel[];
  visible: boolean;
  onShown?: (visible: boolean) => void;
}

export class CrispPanels {
  private readonly layer = document.createElement('div');
  private readonly masks = new Set<AbstractMesh>();
  private readonly shown: Shown[] = [];

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
  // cutting the hole with `mask`, the mesh of those panels; an image still loading shows once it
  // has. `onShown` hears when the frame comes into and goes out of view, and `crt` draws it like an
  // old screen, with scanlines. Returns what to call when `source` has been drawn again.
  add(
    mask: AbstractMesh,
    panels: FramePanel[],
    source: HTMLCanvasElement | HTMLImageElement,
    { onShown, crt = false }: { onShown?: (visible: boolean) => void; crt?: boolean } = {},
  ): () => void {
    const mat = new StandardMaterial(`${mask.name}-hole`, mask.getScene());
    mat.disableColorWrite = true;
    mat.backFaceCulling = false;
    mask.material = mat;
    this.masks.add(mask);
    const frame: Shown = { mask, panels: [], visible: false, onShown };
    this.shown.push(frame);
    // Scanlines are fixed in metres, so every screen has the same pitch, whatever its resolution.
    const [first] = panels;
    const tall = first ? Vector3.Distance(toVector(first.corners[3]), toVector(first.corners[0])) : 1;
    const rows = Math.max(1, Math.round(tall / SCANLINE));
    const repaint = () => {
      for (const { el, u } of frame.panels) {
        const ctx = el.getContext('2d')!;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(source, source.width * u[0], 0, el.width, el.height, 0, 0, el.width, el.height);
        if (crt) scanlines(ctx, el.width, el.height, rows);
      }
    };
    const build = () => {
      frame.panels = panels.map(({ corners: [bl, , tr, tl], u }) => {
        const el = document.createElement('canvas');
        el.width = Math.max(1, Math.round(source.width * (u[1] - u[0])));
        el.height = source.height;
        el.style.width = `${el.width}px`;
        el.style.height = `${el.height}px`;
        el.style.visibility = frame.visible ? '' : 'hidden';
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
      repaint();
    };
    if (source instanceof HTMLImageElement && !source.complete) source.addEventListener('load', build, { once: true });
    else build();
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
        frame.onShown?.(visible);
      }
      if (!visible) continue;
      for (const { el, toWorld } of frame.panels)
        el.style.transform = `matrix3d(${toWorld.multiply(view).m.join(',')})`;
    }
  }
}

// Soft dark bands, `rows` of them down a `w` × `h` canvas: a darker core with a fainter edge.
function scanlines(ctx: CanvasRenderingContext2D, w: number, h: number, rows: number): void {
  const pitch = h / rows;
  for (let i = 0; i < rows; i++) {
    const y = i * pitch;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, y + pitch * 0.35, w, pitch * 0.6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(0, y + pitch * 0.5, w, pitch * 0.3);
  }
}

const toVector = ({ x, y, z }: { x: number; y: number; z: number }) => new Vector3(x, y, z);
