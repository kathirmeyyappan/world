// The look of an old screen over a wall frame's picture (WallFrames): a few soft light and dark
// bands rolling down it and faint static jumping about, drawn by a shader on a translucent pass
// over the frame's panels, a hair in front of the picture. Computed pixel by pixel, so it costs no
// memory however big the picture is, and a browser compositing nothing is what keeps a phone
// alive in the tower (CrispPanels draws the pictures themselves as page elements).
import { Effect, ShaderMaterial, type Scene } from '@babylonjs/core';

const ROLL = 9; // seconds a band takes to roll down a picture
const STATIC = 8; // new sprinkles of static a second
const STATIC_ALPHA = 0.08; // the most a speck of static shades its pixel

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// \`vUv.y\` runs 0 at a picture's foot to 1 at its top, the same on every panel of a frame, so the
// bands line up round a curved wall. Static is a speck per screen pixel, a fresh sprinkle STATIC
// times a second. The colour is written unmultiplied for the blend, which is why it's divided out.
const FRAGMENT = `
precision highp float;
uniform float time;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 1 at \`at\`, fading to 0 \`reach\` either side of it.
float band(float s, float at, float reach) {
  return max(0.0, 1.0 - abs(s - at) / reach);
}

void main() {
  float down = fract((1.0 - vUv.y) - time / ${ROLL.toFixed(1)});
  float light = 0.05 * band(down, 0.12, 0.12);
  float dark = 0.07 * band(down, 0.56, 0.16);
  vec2 speck = floor(gl_FragCoord.xy) + floor(time * ${STATIC.toFixed(1)}) * 0.37;
  float grain = ${STATIC_ALPHA.toFixed(2)} * hash(speck);
  float tone = step(0.5, hash(speck + 7.3));
  float alpha = light + dark + grain;
  vec3 color = (vec3(light) + vec3(tone) * grain) / max(alpha, 0.0001);
  gl_FragColor = vec4(color, min(alpha, 1.0));
}
`;

export class OldScreen {
  readonly material: ShaderMaterial;

  constructor(scene: Scene) {
    Effect.ShadersStore['oldScreenVertexShader'] = VERTEX;
    Effect.ShadersStore['oldScreenFragmentShader'] = FRAGMENT;
    this.material = new ShaderMaterial('old-screen', scene, 'oldScreen', {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'time'],
      needAlphaBlending: true,
    });
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
  }

  // Each frame: the bands and the static move with the clock.
  tick(): void {
    this.material.setFloat('time', performance.now() / 1000);
  }
}
