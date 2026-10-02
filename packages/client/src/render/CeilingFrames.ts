// Projections under the tower's ceilings (sim/ceilingFrames.ts): a picture or a live page, face
// down, bobbing a little and turning about its centre to line up with the camera's heading, under
// faint scrolling scanlines like an old screen. Each is pickable as `projection-<n>`, for the
// hover line.
//
// A page is an iframe in a layer under the canvas, transformed with CSS to sit exactly where its
// mesh is. The mesh writes depth but no colour and is drawn before anything else, so the canvas
// stays clear (transparent) there unless something nearer covers it: the page shows through the
// hole, hidden by walls and players like any other surface.
import {
  Color4,
  Constants,
  Matrix,
  Mesh,
  MeshBuilder,
  RawTexture,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type AbstractMesh,
  type Camera,
  type SubMesh,
} from '@babylonjs/core';
import { layoutCeilingFrame, type CeilingFrame, type CeilingLayout, type PageShow } from '@world/shared';
import type { Engine } from './Engine';
import type { HungFrame } from './WallFrames';

const BOB = 0.15; // metres up and down from where it hangs
const BOB_PERIOD = 4; // seconds
const TURN_RATE = 4; // 1/s: how quickly it comes round to a new heading
const SCAN_BELOW = 0.03; // metres between a projection and its scanlines, so they never share a plane
const SCAN_ROWS = 90; // dark lines down its height
const SCAN_SPEED = 0.6; // lines a second the pattern drifts by
const LINE_GAP = 0.3; // metres past its far edge that its line hangs from
const CSS_PX_PER_M = 100; // the scale view space is put into before CSS's perspective divide

interface Projection {
  root: TransformNode;
  layout: CeilingLayout;
  scan: Texture;
  hung: HungFrame;
}

interface Page {
  mask: Mesh;
  iframe: HTMLIFrameElement;
  toMesh: Matrix; // the iframe's CSS pixels (y down from its top-left) to its mask's local metres (y up)
}

export class CeilingFrames {
  private readonly projections: Projection[] = [];
  private readonly byMesh = new Map<string, HungFrame>();
  private readonly pages: Page[] = [];
  private readonly masks = new Set<AbstractMesh>();
  private readonly layer = document.createElement('div');
  private time = 0;
  private yaw = 0;

  constructor(engine: Engine, frames: readonly CeilingFrame[]) {
    const scene = engine.scene;
    if (frames.some((f) => f.show.kind === 'page')) {
      this.layer.id = 'pages';
      engine.engine.getRenderingCanvas()?.before(this.layer);
      // Wherever nothing is drawn the canvas is see-through; the sky covers everything else.
      scene.clearColor = new Color4(0, 0, 0, 0);
      const isMask = (s: SubMesh) => (this.masks.has(s.getMesh()) ? 1 : 0);
      // Masks first, so their depth holds back everything behind them; otherwise list order.
      scene.setRenderingOrder(0, (a, b) => isMask(b) - isMask(a));
    }
    frames.forEach((frame, n) => {
      const layout = layoutCeilingFrame(frame);
      const root = new TransformNode(`projection-${n}-root`, scene);
      root.position.set(layout.centre.x, layout.centre.y, layout.centre.z);
      const screen =
        frame.show.kind === 'image'
          ? imageScreen(engine, `projection-${n}`, frame.show.src, layout)
          : this.pageScreen(engine, `projection-${n}`, frame.show, layout);
      // Laid flat with its top (local +y) back toward whoever it's turned to: looking up, the edge
      // nearest you is the top of your view.
      screen.rotation.x = -Math.PI / 2;
      screen.parent = root;
      screen.isPickable = true;

      const scan = scanlines(engine, n);
      const lines = MeshBuilder.CreatePlane(
        `projection-${n}-scan`,
        { width: layout.width, height: layout.height, sideOrientation: Mesh.DOUBLESIDE },
        scene,
      );
      const mat = new StandardMaterial(`projection-${n}-scan-mat`, scene);
      mat.disableLighting = true;
      mat.diffuseTexture = scan;
      mat.useAlphaFromDiffuseTexture = true;
      scan.hasAlpha = true;
      lines.material = mat;
      lines.rotation.x = -Math.PI / 2;
      lines.position.y = -SCAN_BELOW;
      lines.parent = root;
      lines.isPickable = false;

      const hung = { line: frame.show.line, anchor: new Vector3(), below: true };
      this.byMesh.set(screen.name, hung);
      this.projections.push({ root, layout, scan, hung });
    });
  }

  private pageScreen(engine: Engine, name: string, show: PageShow, layout: CeilingLayout): Mesh {
    const mask = MeshBuilder.CreatePlane(
      name,
      { width: layout.width, height: layout.height, sideOrientation: Mesh.DOUBLESIDE },
      engine.scene,
    );
    const mat = new StandardMaterial(`${name}-mat`, engine.scene);
    mat.disableColorWrite = true;
    mask.material = mat;
    this.masks.add(mask);

    const iframe = document.createElement('iframe');
    iframe.src = show.src;
    iframe.className = 'projection-page';
    iframe.tabIndex = -1;
    // Same-origin within its own site, so its requests carry its origin for CORS.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    const w = show.width;
    const h = Math.round(show.width / show.aspect);
    iframe.style.width = `${w}px`;
    iframe.style.height = `${h}px`;
    this.layer.append(iframe);
    const k = layout.width / w;
    const toMesh = Matrix.Translation(-w / 2, -h / 2, 0).multiply(Matrix.Scaling(k, -k, 1));
    this.pages.push({ mask, iframe, toMesh });
    return mask;
  }

  // Bob, come round to the camera's heading, drift the scanlines, and put each page where its mask
  // is as `camera` sees it.
  update(dt: number, yaw: number, camera: Camera): void {
    this.time += dt;
    const behind = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    this.yaw += behind * Math.min(1, dt * TURN_RATE);
    const bob = BOB * Math.sin((2 * Math.PI * this.time) / BOB_PERIOD);
    const ahead = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const { root, layout, scan, hung } of this.projections) {
      root.position.y = layout.centre.y + bob;
      root.rotation.y = this.yaw;
      scan.vOffset = (this.time * SCAN_SPEED) / SCAN_ROWS;
      hung.anchor.copyFrom(root.position).addInPlace(ahead.scale(layout.height / 2 + LINE_GAP));
    }
    if (this.pages.length === 0) return;
    // CSS's perspective puts the eye this many pixels in front of the screen.
    const eye = this.layer.clientHeight / 2 / Math.tan(camera.fov / 2);
    this.layer.style.perspective = `${eye}px`;
    // View space (x right, y up, z ahead) to CSS's (y down, z toward the eye), the eye at `eye`.
    const toCss = Matrix.Scaling(CSS_PX_PER_M, -CSS_PX_PER_M, -CSS_PX_PER_M).multiply(Matrix.Translation(0, 0, eye));
    const view = camera.getViewMatrix();
    for (const { mask, iframe, toMesh } of this.pages) {
      const m = toMesh.multiply(mask.computeWorldMatrix(true)).multiply(view).multiply(toCss);
      iframe.style.transform = `matrix3d(${m.m.join(',')})`;
    }
  }

  // The projection a picked mesh is, if it's one of these.
  at(meshName: string): HungFrame | null {
    return this.byMesh.get(meshName) ?? null;
  }
}

function imageScreen(engine: Engine, name: string, src: string, layout: CeilingLayout): Mesh {
  const scene = engine.scene;
  const mesh = MeshBuilder.CreatePlane(
    name,
    { width: layout.width, height: layout.height, sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
  const mat = new StandardMaterial(`${name}-mat`, scene);
  const tex = new Texture(src, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mesh.material = mat;
  return mesh;
}

// One dark row in every three, repeated SCAN_ROWS times down the projection.
function scanlines(engine: Engine, n: number): Texture {
  const rows = new Uint8Array([0, 0, 0, 70, 0, 0, 0, 0, 0, 0, 0, 0]);
  const tex = RawTexture.CreateRGBATexture(
    rows,
    1,
    3,
    engine.scene,
    false,
    false,
    Constants.TEXTURE_NEAREST_SAMPLINGMODE,
  );
  tex.name = `projection-${n}-scan-tex`;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.vScale = SCAN_ROWS;
  return tex;
}
