// Frames on the tower's walls (sim/wallFrames.ts): each a picture or a live widget, drawn sharp by
// the browser through a hole in the scene (CrispPanels), on a wood border set a little further
// back, both following the wall round segment by segment. The picture's mesh is pickable as
// `frame-<n>`, for the hover line; the border isn't.
import { Color3, Mesh, StandardMaterial, Vector3, VertexData, type Camera } from '@babylonjs/core';
import { layoutWallFrame, OFF_WALL, type FramePanel, type WallFrame } from '@world/shared';
import { WIDGETS } from '../widgets';
import { CrispPanels } from './CrispPanels';
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
  private readonly crisp: CrispPanels;

  constructor(engine: Engine, frames: readonly WallFrame[]) {
    const scene = engine.scene;
    this.crisp = new CrispPanels(engine);
    const wood = new StandardMaterial('frame-wood', scene);
    wood.disableLighting = true;
    wood.emissiveColor = WOOD;
    frames.forEach((frame, n) => {
      const picture = layoutWallFrame(frame);
      const mesh = panelsMesh(engine, `frame-${n}`, picture.panels);
      const { show } = frame;
      if (show.kind === 'image') {
        const img = new Image();
        img.src = show.src;
        this.crisp.add(mesh, picture.panels, img);
      } else {
        const widget = WIDGETS[show.widget](show.aspect);
        widget.onPaint = this.crisp.add(mesh, picture.panels, widget.canvas, widget.setShown);
      }
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

  // Line the pictures up with where `camera` sees their frames.
  update(camera: Camera): void {
    this.crisp.update(camera);
  }

  // The frame a picked mesh is, if it's one of these.
  at(meshName: string): HungFrame | null {
    return this.byMesh.get(meshName) ?? null;
  }
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
