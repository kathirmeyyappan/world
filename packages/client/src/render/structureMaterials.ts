// Pixel-art textures for structure materials (sim/structures.ts `StructureMaterial`), painted once at
// load onto tiny canvases and drawn nearest-neighbour up close, so every texel reads as a chunky
// pixel. One repeat of a texture covers its `tile` in metres, and the renderer maps faces in metres,
// so a brick is the same size on every wall. Keep texels big (a few per metre): fine detail on a big
// wall aliases into moiré. A new material is a painter here; the Record makes it required.
import { createRng, hashSeed, type Rng, type StructureMaterial } from '@world/shared';

export const TEXELS = 32; // texels per repeat along each side

export interface MaterialSpec {
  paint(px: (x: number, y: number, color: string) => void, rng: Rng): void;
  tile: number; // metres covered by one repeat of the texture
  // Floors and decks tile in world x/z, so neighbouring pieces line up; anything else is mapped
  // in its own frame (a stair's planks run along each step).
  worldTop: boolean;
}

const pick = (rng: Rng, colors: string[]) => colors[Math.floor(rng() * colors.length)];

// Courses of 1.5 × 0.75 m blocks (8 × 4 texels), each course offset by half a block, with a lit
// top edge and a shaded bottom edge on every block, kept gentle so distant walls don't shimmer.
const brick: MaterialSpec = {
  tile: 6,
  worldTop: false,
  paint(px, rng) {
    const shades = ['#77767e', '#6e6d76', '#817f86', '#6a6972', '#7d787a', '#726f79', '#86838a'];
    for (let row = 0; row < TEXELS / 4; row++) {
      const offset = row % 2 ? 4 : 0;
      for (let b = 0; b < TEXELS / 8; b++) {
        const color = pick(rng, shades);
        for (let i = 0; i < 8; i++) {
          const x = (b * 8 + i + offset) % TEXELS;
          for (let j = 0; j < 4; j++) {
            const y = row * 4 + j;
            if (j === 3 || i === 7)
              px(x, y, '#46454d'); // mortar
            else if (j === 0) px(x, y, '#8c8990');
            else if (j === 2 && rng() < 0.5) px(x, y, '#65646c');
            else px(x, y, rng() < 0.08 ? '#8e8b92' : color);
          }
        }
      }
    }
  },
};

// Planks 0.375 m wide (4 texels) with dark seams and a little grain: two to a stair tread.
const wood: MaterialSpec = {
  tile: 3,
  worldTop: false,
  paint(px, rng) {
    const shades = ['#7a5233', '#6f4a2d', '#83593a', '#754f31'];
    for (let plank = 0; plank < TEXELS / 4; plank++) {
      const color = pick(rng, shades);
      for (let j = 0; j < 4; j++) {
        for (let x = 0; x < TEXELS; x++) {
          const y = plank * 4 + j;
          if (j === 3) px(x, y, '#3a2515');
          else px(x, y, rng() < 0.12 ? '#5c3b22' : j === 0 ? '#8c6443' : color);
        }
      }
    }
  },
};

// 0.75 m red tiles (8 texels) with dark grout and a highlight in each tile's corner.
const redTile: MaterialSpec = {
  tile: 3,
  worldTop: true,
  paint(px, rng) {
    const shades = ['#8a2e2a', '#973530', '#7d2926', '#a03b33', '#8f312c'];
    for (let ty = 0; ty < TEXELS / 8; ty++) {
      for (let tx = 0; tx < TEXELS / 8; tx++) {
        const color = pick(rng, shades);
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            const x = tx * 8 + i;
            const y = ty * 8 + j;
            if (i === 7 || j === 7) px(x, y, '#3a1515');
            else if (i === 0 && j === 0) px(x, y, '#c0544a');
            else px(x, y, rng() < 0.06 ? '#732522' : color);
          }
        }
      }
    }
  },
};

// 2 m paving stones (16 texels) in offset rows.
const flagstone: MaterialSpec = {
  tile: 4,
  worldTop: true,
  paint(px, rng) {
    const shades = ['#5f636b', '#686c74', '#595d65', '#6c6f76'];
    for (let row = 0; row < TEXELS / 16; row++) {
      const offset = row % 2 ? 8 : 0;
      for (let s = 0; s < TEXELS / 16; s++) {
        const color = pick(rng, shades);
        for (let i = 0; i < 16; i++) {
          for (let j = 0; j < 16; j++) {
            const x = (s * 16 + i + offset) % TEXELS;
            const y = row * 16 + j;
            if (i === 15 || j === 15) px(x, y, '#34363c');
            else px(x, y, rng() < 0.07 ? '#50535a' : color);
          }
        }
      }
    }
  },
};

export const MATERIALS: Record<StructureMaterial, MaterialSpec> = {
  brick,
  wood,
  'red-tile': redTile,
  flagstone,
};

// One material's texture as canvas pixels, deterministic for a given material.
export function paintMaterial(ctx: CanvasRenderingContext2D, material: StructureMaterial): void {
  const rng = createRng(hashSeed(material));
  MATERIALS[material].paint((x, y, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }, rng);
}
