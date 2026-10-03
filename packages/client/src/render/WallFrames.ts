// Frames on the tower's walls (sim/wallFrames.ts): each a picture or a live widget, unlit like the
// structures, on a wood border set a little further back, both following the wall round segment
// by segment. The picture is pickable as `frame-<n>`, for the hover line; the border isn't.
import {
  Color3,
  DynamicTexture,
  Mesh,
  StandardMaterial,
  Texture,
  Vector3,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import {
  layoutWallFrame,
  OFF_WALL,
  type FramePanel,
  type FrameShow,
  type WallFrame,
  type WidgetName,
} from '@world/shared';
import { WIDGETS } from '../widgets';
import type { Engine } from './Engine';

const BORDER = 0.48; // metres of wood showing round every picture
const BORDER_BACK = 0.015; // metres the border sits behind the picture, so the two never share a plane
const WOOD = new Color3(0.42, 0.27, 0.15);
const LINE_GAP = 0.3; // metres between the top of a frame's border and the bottom of its line

export interface HungFrame {
  frame: WallFrame;
  above: Vector3; // where its line sits: just over the middle of its top edge, on the wall
}

export class WallFrames {
  private readonly byMesh = new Map<string, HungFrame>();

  constructor(engine: Engine, frames: readonly WallFrame[]) {
    const scene = engine.scene;
    const wood = new StandardMaterial('frame-wood', scene);
    wood.disableLighting = true;
    wood.emissiveColor = WOOD;
    frames.forEach((frame, n) => {
      const picture = layoutWallFrame(frame);
      const mesh = panelsMesh(engine, `frame-${n}`, picture.panels);
      const mat = new StandardMaterial(`frame-${n}-mat`, scene);
      const tex = pictureOf(frame.show, `frame-${n}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveTexture = tex;
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mesh.material = mat;
      mesh.isPickable = true;
      const border = panelsMesh(
        engine,
        `frame-${n}-border`,
        layoutWallFrame(frame, OFF_WALL - BORDER_BACK, BORDER).panels,
      );
      border.material = wood;
      border.isPickable = false;
      const { x, z } = picture.centre;
      this.byMesh.set(mesh.name, { frame, above: new Vector3(x, picture.top + BORDER + LINE_GAP, z) });
    });
  }

  // The frame a picked mesh is, if it's one of these.
  at(meshName: string): HungFrame | null {
    return this.byMesh.get(meshName) ?? null;
  }
}

// What a frame shows, as a texture: an image, or a widget's canvas, taken up again each time the
// widget repaints.
function pictureOf(show: FrameShow, name: string, scene: Scene): Texture {
  const tex =
    show.kind === 'image' ? new Texture(show.src, scene) : widgetTexture(show.widget, show.aspect, name, scene);
  // Frames are mostly seen at an angle round the curved wall, where plain mipmapping blurs most.
  tex.anisotropicFilteringLevel = 16;
  return tex;
}

function widgetTexture(name: WidgetName, aspect: number, mesh: string, scene: Scene): Texture {
  const widget = WIDGETS[name](aspect);
  const tex = new DynamicTexture(`${mesh}-widget`, widget.canvas, scene, true);
  widget.onPaint = () => tex.update();
  tex.update();
  return tex;
}

// One mesh from a frame's flat panels, the picture mapped across them by their `u`.
function panelsMesh(engine: Engine, name: string, panels: FramePanel[]): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const { corners, u } of panels) {
    const base = positions.length / 3;
    for (const c of corners) positions.push(c.x, c.y, c.z);
    uvs.push(u[0], 0, u[1], 0, u[1], 1, u[0], 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const mesh = new Mesh(name, engine.scene);
  Object.assign(new VertexData(), { positions, uvs, indices }).applyToMesh(mesh);
  return mesh;
}
