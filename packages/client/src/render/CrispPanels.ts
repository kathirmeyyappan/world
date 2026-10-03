// Pictures the browser draws itself, at full screen resolution, in a layer under the 3D canvas,
// each lined up with a flat panel in the scene. The 3D view renders at a fraction of the screen's
// resolution (Engine's PIXEL_SCALE), which is the look everywhere else but turns small text to
// mush; this is for what has to stay sharp, like the pictures on the tower's walls.
//
// A panel's mesh writes depth but no colour and is drawn before everything else, and the scene
// clears to transparent (the sky covers the rest), so the canvas stays see-through exactly where
// the panel is and nothing nearer covers it: walls and players hide a panel like any surface. The
// pictures are plain canvases the page has already drawn, so moving them each frame is only the
// browser placing a texture; they're repainted only when their source changes.
//
// Only a panel in view and within CRISP_RANGE is shown this way (and whoever drew it told it's
// seen). Further off, a picture is a few dozen pixels across, and every shown panel is layers the
// browser composites on every frame (an old screen's several, however small), seen through a wall
// or not; there its mesh draws the picture as an ordinary texture in the scene, as still as the
// source was when it went.
import {
  Color3,
  Color4,
  DynamicTexture,
  Frustum,
  Matrix,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
  type Camera,
  type Material,
} from '@babylonjs/core';
import type { FramePanel } from '@world/shared';
import type { Engine } from './Engine';

const CSS_PX_PER_M = 100; // the scale view space is put into before CSS's perspective divide
const CRISP_RANGE = 45; // metres: a round room's width, and a little past where a frame's line reads

interface Panel {
  box: HTMLDivElement; // placed in the scene; holds the picture and, on an old screen, its static
  el: HTMLCanvasElement;
  toWorld: Matrix; // the element's CSS pixels (from its top-left, y down) to world metres
  u: [number, number]; // the stretch of the source it shows, as fractions of its width
}

interface Shown {
  mask: AbstractMesh;
  hole: Material; // writes depth only, for the crisp picture to show through
  still: Material; // the picture as a texture in the scene, for when it's far off
  stillTexture: Texture;
  panels: Panel[];
  visible: boolean; // shown crisp
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
  // has. `onShown` hears when the frame comes into and goes out of view, and `crt` plays it like an
  // old screen, with faint bands rolling down it and a little static. Returns what to call when
  // `source` has been drawn again.
  add(
    mask: AbstractMesh,
    panels: FramePanel[],
    source: HTMLCanvasElement | HTMLImageElement,
    { onShown, crt = false }: { onShown?: (visible: boolean) => void; crt?: boolean } = {},
  ): () => void {
    const scene = mask.getScene();
    const hole = new StandardMaterial(`${mask.name}-hole`, scene);
    hole.disableColorWrite = true;
    hole.backFaceCulling = false;
    const stillTexture =
      source instanceof HTMLImageElement
        ? new Texture(source.src, scene)
        : new DynamicTexture(`${mask.name}-still`, source, scene);
    const still = new StandardMaterial(`${mask.name}-still`, scene);
    still.disableLighting = true;
    still.emissiveTexture = stillTexture;
    still.diffuseColor = still.specularColor = Color3.Black();
    mask.material = still;
    this.masks.add(mask);
    const frame: Shown = { mask, hole, still, stillTexture, panels: [], visible: false, onShown };
    this.shown.push(frame);
    const repaint = () => {
      for (const { el, u } of frame.panels) {
        const ctx = el.getContext('2d')!;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(source, source.width * u[0], 0, el.width, el.height, 0, 0, el.width, el.height);
      }
    };
    const build = () => {
      frame.panels = panels.map(({ corners: [bl, , tr, tl], u }) => {
        const box = document.createElement('div');
        const el = document.createElement('canvas');
        el.width = Math.max(1, Math.round(source.width * (u[1] - u[0])));
        el.height = source.height;
        box.className = 'crisp-panel';
        box.style.width = `${el.width}px`;
        box.style.height = `${el.height}px`;
        box.style.visibility = frame.visible ? '' : 'hidden';
        box.append(el);
        // The bands and the static move by CSS animation alone, which the browser runs on the
        // GPU without painting anything again.
        if (crt)
          box.append(div('crt-roll'), Object.assign(div('crt-static'), { style: `background-image: ${noise()}` }));
        this.layer.append(box);
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
        const slice: Panel = { box, el, toWorld, u };
        return slice;
      });
      repaint();
    };
    if (source instanceof HTMLImageElement && !source.complete) source.addEventListener('load', build, { once: true });
    else build();
    return repaint;
  }

  // Put every panel where `camera` sees its mesh, and hide the ones out of view or far off.
  update(camera: Camera): void {
    // CSS's perspective puts the eye this many pixels in front of the screen.
    const eye = this.layer.clientHeight / 2 / Math.tan(camera.fov / 2);
    this.layer.style.perspective = `${eye}px`;
    // View space (x right, y up, z ahead) to CSS's (y down, z toward the eye), the eye at `eye`.
    const toCss = Matrix.Scaling(CSS_PX_PER_M, -CSS_PX_PER_M, -CSS_PX_PER_M).multiply(Matrix.Translation(0, 0, eye));
    const view = camera.getViewMatrix().multiply(toCss);
    const frustum = Frustum.GetPlanes(camera.getTransformationMatrix());
    for (const frame of this.shown) {
      const near =
        Vector3.Distance(camera.globalPosition, frame.mask.getBoundingInfo().boundingSphere.centerWorld) < CRISP_RANGE;
      const visible = near && frame.mask.isInFrustum(frustum);
      if (visible !== frame.visible) {
        frame.visible = visible;
        for (const { box } of frame.panels) box.style.visibility = visible ? '' : 'hidden';
        if (!visible && frame.stillTexture instanceof DynamicTexture) frame.stillTexture.update();
        frame.mask.material = visible ? frame.hole : frame.still;
        frame.onShown?.(visible);
      }
      if (!visible) continue;
      for (const { box, toWorld } of frame.panels)
        box.style.transform = `matrix3d(${toWorld.multiply(view).m.join(',')})`;
    }
  }
}

function div(className: string): HTMLDivElement {
  return Object.assign(document.createElement('div'), { className });
}

// A tile of faint light and dark specks for the static, made once: a CSS image value.
let noiseTile = '';
function noise(): string {
  if (noiseTile) return noiseTile;
  const size = 128;
  const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const light = Math.random() < 0.5;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = light ? 255 : 0;
    img.data[i + 3] = Math.random() * 40;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = `url(${c.toDataURL()})`;
  return noiseTile;
}
