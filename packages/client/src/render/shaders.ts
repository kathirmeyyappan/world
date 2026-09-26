// GLSL for the environment. Kept in one place so the ground, sky and boundary share helpers.

export const GROUND_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorld;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Two-scale grid, anti-aliased with screen-space derivatives, fading with distance into the fog
// colour. `playRadius` is where the walkable world ends; the grid dims past it.
export const GROUND_FRAGMENT = `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPos;
uniform vec3 lineColor;
uniform vec3 majorColor;
uniform vec3 floorColor;
uniform vec3 fogColor;
uniform float playRadius;
uniform float time;

float gridLine(vec2 p, float spacing, float width) {
  vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
  vec2 fw = fwidth(p) * 1.2;
  vec2 a = 1.0 - smoothstep(width - fw, width + fw, g);
  return max(a.x, a.y);
}

void main() {
  vec2 p = vWorld.xz;
  float dist = length(p - cameraPos.xz);
  float minor = gridLine(p, 2.0, 0.045);
  float major = gridLine(p, 10.0, 0.09);
  float r = length(p);
  float inside = 1.0 - smoothstep(playRadius - 2.0, playRadius + 6.0, r);
  float pulse = 0.85 + 0.15 * sin(time * 1.5 - r * 0.15);
  vec3 col = floorColor;
  col = mix(col, lineColor * pulse, minor * 0.55 * (0.4 + 0.6 * inside));
  col = mix(col, majorColor * pulse, major * 0.9 * (0.5 + 0.5 * inside));
  float fog = 1.0 - exp(-dist * dist * 0.00035);
  col = mix(col, fogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SKY_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Vertical gradient with a horizon glow and a sparse field of stars from a hash.
export const SKY_FRAGMENT = `
precision highp float;
varying vec3 vDir;
uniform vec3 fogColor;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform float time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(horizonColor, zenithColor, pow(h, 0.6));
  col = mix(fogColor, col, smoothstep(-0.02, 0.12, vDir.y));
  vec2 cell = floor(vDir.xz / max(vDir.y, 0.05) * 60.0);
  float star = step(0.995, hash(cell)) * smoothstep(0.08, 0.35, vDir.y);
  float twinkle = 0.6 + 0.4 * sin(time * 2.0 + hash(cell + 1.0) * 6.28);
  col += vec3(0.9, 0.95, 1.0) * star * twinkle * 0.8;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const WALL_VERTEX = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorld;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// The play boundary: a hex mesh that only appears when the camera is close to it.
export const WALL_FRAGMENT = `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPos;
uniform vec3 wallColor;
uniform float revealDistance;
uniform float time;

float hexLine(vec2 p, float scale, float width) {
  p /= scale;
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  float d = max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
  float edge = 0.5 - d;
  float fw = fwidth(edge) * 1.5;
  return 1.0 - smoothstep(width - fw, width + fw, edge);
}

void main() {
  float angle = atan(vWorld.z, vWorld.x);
  vec2 uv = vec2(angle * 50.0, vWorld.y);
  float line = hexLine(uv, 1.6, 0.06);
  float dist = length(vWorld.xz - cameraPos.xz);
  float reveal = 1.0 - smoothstep(revealDistance * 0.4, revealDistance, dist);
  float heightFade = 1.0 - smoothstep(6.0, 14.0, vWorld.y);
  float pulse = 0.8 + 0.2 * sin(time * 3.0 + vWorld.y * 0.8);
  float alpha = line * reveal * heightFade * pulse;
  gl_FragColor = vec4(wallColor * (0.6 + 0.4 * reveal), alpha);
}
`;
