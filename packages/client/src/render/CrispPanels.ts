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
// seen). Further off, a picture is a few dozen pixels across, and every shown panel is a layer the
// browser composites on every frame, seen through a wall or not; there its mesh draws the picture
// as an ordinary texture in the scene, as still as the source was when it went. Over the last FADE
// metres in, that texture fades out over the crisp picture rather than swapping in a frame: drawn
// first like a hole, it writes its opacity into the canvas's alpha, and the page blends the canvas
// over the layer beneath. An old screen's bands and static over a picture are a translucent mesh
// in the scene (OldScreen), shown with the crisp picture; nothing else is composited per frame.
import {
  Color3,
  Color4,
  Constants,
  DynamicTexture,
  Frustum,
  Material,
  Matrix,
  StandardMaterial,
  Texture,
  Vector3,
  type AbstractMesh,
  type Camera,
} from '@babylonjs/core';
import type { FramePanel } from '@world/shared';
import type { Engine } from './Engine';

const CSS_PX_PER_M = 100; // the scale view space is put into before CSS's perspective divide
const CRISP_RANGE = 45; // metres: a round room's width, and a little past where a frame's line reads
const FADE = 10; // metres inside CRISP_RANGE over which the still picture gives way to the crisp one

interface Panel {
  box: HTMLDivElement; // placed in the scene; holds the picture
  el: HTMLCanvasElement;
  toWorld: Matrix; // the element's CSS pixels (from its top-left, y down) to world metres
  u: [number, number]; // the stretch of the source it shows, as fractions of its width
}

interface Shown {
  mask: AbstractMesh;
  hole: Material; // writes depth only, for the crisp picture to show through
  still: StandardMaterial; // the picture as a texture in the scene, for when it's far off
  stillTexture: Texture;
  panels: Panel[];
  visible: boolean; // shown crisp
  onShown?: (visible: boolean) => void;
  screen?: AbstractMesh; // an old screen's look over the picture, shown while the picture is crisp
}

export class CrispPanels {
  private readonly layer = document.createElement('div');
  // Every frame's mask, with how far its middle was from the camera at the last update().
  private readonly masks = new Map<AbstractMesh, number>();
  private readonly shown: Shown[] = [];

  constructor(engine: Engine) {
    const scene = engine.scene;
    this.layer.id = 'crisp-panels';
    engine.engine.getRenderingCanvas()?.before(this.layer);
    scene.clearColor = new Color4(0, 0, 0, 0);
    // Masks first, so their depth holds back everything behind them, and the nearest of them first:
    // a hole writes no colour, so a farther frame's still picture drawn before it would stay in the
    // canvas over the crisp one. Everything else in list order.
    scene.setRenderingOrder(0, (a, b) => {
      const da = this.masks.get(a.getMesh());
      const db = this.masks.get(b.getMesh());
      if (da === undefined || db === undefined) return (da === undefined ? 1 : 0) - (db === undefined ? 1 : 0);
      return da - db;
    });
  }

  // Show `source` across a frame's `panels` (its picture's layout, `u` running 0 to 1 across it),
  // cutting the hole with `mask`, the mesh of those panels; an image still loading shows once it
  // has. `onShown` hears when the frame comes into and goes out of view, and `screen` is drawn over
  // the picture while it's crisp. Returns what to call when `source` has been drawn again.
  add(
    mask: AbstractMesh,
    panels: FramePanel[],
    source: HTMLCanvasElement | HTMLImageElement,
    { onShown, screen }: { onShown?: (visible: boolean) => void; screen?: AbstractMesh } = {},
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
    // Drawn with the opaque meshes (so first, with the holes) but writing its `alpha`, premultiplied.
    still.transparencyMode = Material.MATERIAL_OPAQUE;
    still.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    mask.material = still;
    this.masks.set(mask, Infinity);
    screen?.setEnabled(false);
    const frame: Shown = { mask, hole, still, stillTexture, panels: [], visible: false, onShown, screen };
    this.shown.push(frame);
    const repaint = () => {
      for (const { el, u } of frame.panels) {
        const ctx = el.getContext('2d')!;
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(source, source.width * u[0], 0, el.width, el.height, 0, 0, el.width, el.height);
      }
      if (frame.mask.material === still && stillTexture instanceof DynamicTexture) stillTexture.update();
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
      const far = Vector3.Distance(camera.globalPosition, frame.mask.getBoundingInfo().boundingSphere.centerWorld);
      this.masks.set(frame.mask, far);
      const visible = far < CRISP_RANGE && frame.mask.isInFrustum(frustum);
      if (visible !== frame.visible) {
        frame.visible = visible;
        for (const { box } of frame.panels) box.style.visibility = visible ? '' : 'hidden';
        frame.screen?.setEnabled(visible);
        frame.onShown?.(visible);
      }
      // How much of the still picture shows over the crisp one: all of it when the crisp one isn't.
      const still = visible ? Math.min(1, Math.max(0, (far - (CRISP_RANGE - FADE)) / FADE)) : 1;
      const material = still > 0 ? frame.still : frame.hole;
      if (
        material === frame.still &&
        frame.mask.material !== frame.still &&
        frame.stillTexture instanceof DynamicTexture
      )
        frame.stillTexture.update();
      frame.mask.material = material;
      frame.still.alpha = still;
      if (!visible) continue;
      for (const { box, toWorld } of frame.panels)
        box.style.transform = `matrix3d(${toWorld.multiply(view).m.join(',')})`;
    }
  }
}
