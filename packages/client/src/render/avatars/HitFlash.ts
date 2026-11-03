// Tints an avatar's materials: red for a moment when it takes a hit, and frosted over for as long as
// it is frozen (an ice hit, sim/constants.ts), dimmed and blued under a crust of ice crystals.
// Time-based rather than frame-based so it looks the same at any frame rate; the avatar calls
// update() from its own per-frame update with whether its player is frozen. A material that glows
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
  private frozen = false;

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

  update(frozen = false): void {
    if (frozen !== this.frozen) {
      this.frozen = frozen;
      for (const { frost } of this.originals) frost.frost = frozen ? 1 : 0;
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

// The crust, laid over a pixel once the material has shaded it: `frost` (0 to 1) of the way to the
// colour dimmed and blued, white where a crystal is. The crystals are cells of two sizes, each
// chosen by a hash of where the pixel is in the world, which stays put as long as a frozen body
// does; so no texture, no UVs, and nothing but one comparison while thawed.
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
          vec3 small = floor(vPositionW * 24.0);
          vec3 big = floor(vPositionW * 7.0);
          float a = fract(sin(dot(small, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float b = fract(sin(dot(big, vec3(39.3468, 11.135, 83.155))) * 24634.6345);
          float crystal = max(step(0.68, a), 0.85 * step(0.8, b));
          vec3 iced = gl_FragColor.rgb * vec3(0.5, 0.68, 0.92);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(iced, vec3(0.93, 0.97, 1.0), crystal), frost);
        }
        #endif
      `,
    };
  }
}
