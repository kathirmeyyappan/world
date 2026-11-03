// Tints an avatar's materials: red for a moment when it takes a hit, and frosted over for as long as
// it is chilled (an ice hit, sim/constants.ts), dimmed and blued under a crust of ice crystals.
// Time-based rather than frame-based so it looks the same at any frame rate; the avatar calls
// update() from its own per-frame update with whether its player is chilled. A material that glows
// through a texture glows plain red for the moment.
import {
  Color3,
  MaterialPluginBase,
  type BaseTexture,
  type Material,
  type MaterialDefines,
  type StandardMaterial,
  type UniformBuffer,
} from '@babylonjs/core';

const FLASH_MS = 140;
const FLASH_COLOR = new Color3(1, 0.12, 0.16);

export class HitFlash {
  private readonly originals: {
    mat: StandardMaterial;
    diffuse: Color3;
    emissive: Color3;
    emissiveTexture: BaseTexture | null;
    frost: FrostPlugin;
  }[];
  private until = 0;
  private lit = false;
  private chilled = false;

  // Takes the materials before anything is drawn with them: the frost is shader code of theirs.
  constructor(materials: StandardMaterial[]) {
    this.originals = materials.map((mat) => ({
      mat,
      diffuse: mat.diffuseColor.clone(),
      emissive: mat.emissiveColor.clone(),
      emissiveTexture: mat.emissiveTexture,
      frost: new FrostPlugin(mat),
    }));
  }

  trigger(): void {
    this.until = performance.now() + FLASH_MS;
    if (this.lit) return;
    this.lit = true;
    for (const { mat } of this.originals) {
      mat.diffuseColor = FLASH_COLOR;
      mat.emissiveColor = FLASH_COLOR.scale(0.6);
      mat.emissiveTexture = null;
    }
  }

  update(chilled = false): void {
    if (chilled !== this.chilled) {
      this.chilled = chilled;
      for (const { frost } of this.originals) frost.frost = chilled ? 1 : 0;
    }
    if (!this.lit || performance.now() < this.until) return;
    this.lit = false;
    for (const { mat, diffuse, emissive, emissiveTexture } of this.originals) {
      mat.diffuseColor = diffuse;
      mat.emissiveColor = emissive;
      mat.emissiveTexture = emissiveTexture;
    }
  }
}

// The frost, laid over a pixel once the material has shaded it: `frost` (0 to 1) of the way to the
// colour paled a little, and to ice where a patch of it is. The patches are cells of two sizes,
// each chosen by a hash of where the pixel is in the world, which stays put as long as a chilled
// body does; so no texture, no UVs, and nothing but one comparison while thawed.
class FrostPlugin extends MaterialPluginBase {
  frost = 0;

  constructor(material: Material) {
    super(material, 'Frost', 200, { FROST: true }, true, true);
  }

  getClassName(): string {
    return 'FrostPlugin';
  }

  prepareDefines(defines: MaterialDefines): void {
    defines.FROST = true;
  }

  getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [{ name: 'frost', size: 1, type: 'float' }],
      fragment: '#ifdef FROST\nuniform float frost;\n#endif',
    };
  }

  bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('frost', this.frost);
  }

  getCustomCode(shaderType: string): { [point: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_MAIN_END: `
        #ifdef FROST
        if (frost > 0.0) {
          vec3 big = floor(vPositionW * 4.0);
          vec3 small = floor(vPositionW * 10.0);
          float a = fract(sin(dot(big, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float b = fract(sin(dot(small, vec3(39.3468, 11.135, 83.155))) * 24634.6345);
          float ice = max(step(0.86, a), step(0.96, b));
          vec3 paled = mix(gl_FragColor.rgb, vec3(0.92, 0.96, 1.0), 0.3);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(paled, vec3(0.9, 0.96, 1.0), ice), frost);
        }
        #endif
      `,
    };
  }
}
