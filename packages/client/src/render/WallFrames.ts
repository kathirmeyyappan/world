// Frames on the tower's walls (sim/wallFrames.ts): each a picture, unlit like the structures, on a
// wood border set a little further back, both following the wall round segment by segment. The
// picture is pickable as `frame-<n>`, for the hover line; the border isn't.
import { Color3, Mesh, StandardMaterial, Texture, Vector3, VertexData } from '@babylonjs/core';
import { layoutWallFrame, OFF_WALL, type FramePanel, type WallFrame } from '@world/shared';
import type { Engine } from './Engine';

const BORDER = 0.08; // metres of wood showing round a picture
const BORDER_BACK = 0.015; // metres the border sits behind the picture, so the two never share a plane
const WOOD = new Color3(0.42, 0.27, 0.15);

export interface HungFrame {
  frame: WallFrame;
  centre: Vector3; // the middle of the picture's face
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
      const tex = new Texture(frame.show.src, scene);
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
      const { x, y, z } = picture.centre;
      this.byMesh.set(mesh.name, { frame, centre: new Vector3(x, y, z) });
    });
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
