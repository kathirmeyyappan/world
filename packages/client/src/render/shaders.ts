// GLSL for the environment. Kept in one place so the ground, sky and boundary share helpers.
import { EYE_HEIGHT } from '@world/shared';
import { BASE_FOG_DENSITY } from './Engine';

// The floor's fog: 1 - exp(-d² × GROUND_FOG × fogScale) at d metres from the camera, the scene's
// own EXP2 fog, so the floor under anything far off fades exactly as much as it does.
export const GROUND_FOG = BASE_FOG_DENSITY ** 2;

// The sky's colour in a direction. Its horizon (`horizon`, the sine of its elevation) is where the
// floor fades into the fog rather than eye level: 0 standing on the floor, below 0 up high, so
// looking out from a tower the glow meets the floor instead of floating over a band of fog.
// Needs fogColor declared first.
const SKY_GRADIENT = `
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform float horizon;

// Height above the horizon, rescaled so the horizon is 0 and straight up is 1.
float aboveHorizon(vec3 dir) {
  return (dir.y - horizon) / (1.0 - horizon);
}

vec3 skyColor(vec3 dir) {
  float y = aboveHorizon(dir);
  vec3 col = mix(horizonColor, zenithColor, pow(clamp(y, 0.0, 1.0), 0.6));
  return mix(fogColor, col, smoothstep(-0.02, 0.12, y));
}
`;

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

// Signed distance to the world's edge, mirroring worldDistance() in shared: discs are (x, z, r),
// bridges are (ax, az, bx, bz) with a half width, and arcs are (x, z, r, half width) with the
// bearings they run between. Counts are capped so the loops stay constant.
export const MAX_DISCS = 8;
export const MAX_BRIDGES = 8;
export const MAX_ARCS = 2;
export const WORLD_SDF = `
uniform vec3 discs[${MAX_DISCS}];
uniform vec4 bridges[${MAX_BRIDGES}];
uniform float bridgeWidths[${MAX_BRIDGES}];
uniform vec4 arcs[${MAX_ARCS}];
uniform vec2 arcSpans[${MAX_ARCS}];
uniform int discCount;
uniform int bridgeCount;
uniform int arcCount;

float worldDistance(vec2 p) {
  float d = 1.0e9;
  for (int i = 0; i < ${MAX_DISCS}; i++) {
    if (i >= discCount) break;
    d = min(d, length(p - discs[i].xy) - discs[i].z);
  }
  for (int i = 0; i < ${MAX_BRIDGES}; i++) {
    if (i >= bridgeCount) break;
    vec2 a = bridges[i].xy;
    vec2 v = bridges[i].zw - a;
    float t = clamp(dot(p - a, v) / max(dot(v, v), 1.0e-6), 0.0, 1.0);
    d = min(d, length(p - (a + v * t)) - bridgeWidths[i]);
  }
  for (int i = 0; i < ${MAX_ARCS}; i++) {
    if (i >= arcCount) break;
    vec2 c = arcs[i].xy;
    float r = arcs[i].z;
    vec2 span = arcSpans[i];
    vec2 q = p - c;
    vec2 spine;
    if (mod(atan(q.y, q.x) - span.x, 6.2831853) <= span.y - span.x) spine = c + q / max(length(q), 1.0e-6) * r;
    else {
      vec2 from = c + r * vec2(cos(span.x), sin(span.x));
      vec2 to = c + r * vec2(cos(span.y), sin(span.y));
      spine = length(p - from) < length(p - to) ? from : to;
    }
    d = min(d, length(p - spine) - arcs[i].w);
  }
  return d;
}
`;

// Two-scale grid, anti-aliased with screen-space derivatives, fading with distance into the sky's
// colour in that direction, so the floor meets the horizon wherever you're standing. Past the world's
// edge the grid dims and turns grey, so where you can't go reads before you reach the wall.
export const GROUND_FRAGMENT = `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPos;
uniform vec3 lineColor;
uniform vec3 majorColor;
uniform vec3 floorColor;
uniform vec3 fogColor;
uniform float fogScale; // 1 normally, small while scoped so the far end is visible
uniform float time;
${WORLD_SDF}
${SKY_GRADIENT}

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
  float sd = worldDistance(p);
  float inside = 1.0 - smoothstep(-2.0, 6.0, sd);
  float pulse = 0.85 + 0.15 * sin(time * 1.5 - length(p) * 0.15);
  vec3 col = floorColor;
  col = mix(col, lineColor * pulse, minor * 0.55 * (0.4 + 0.6 * inside));
  col = mix(col, majorColor * pulse, major * 0.9 * (0.5 + 0.5 * inside));
  float outside = smoothstep(0.0, 1.5, sd); // across the first 1.5 m past the edge
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), outside);
  float fog = 1.0 - exp(-dist * dist * ${GROUND_FOG} * fogScale);
  col = mix(col, skyColor(normalize(vWorld - cameraPos)), fog);
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
uniform float time;
${SKY_GRADIENT}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// A star cell for a direction: the direction projected onto the face of a cube around the camera
// that it points through, cut into 400 × 400 cells per face (a few pixels each), so stars are spread evenly down to
// whatever horizon the view has (it drops below eye level up high).
vec2 starCell(vec3 d) {
  vec3 a = abs(d);
  vec2 uv;
  float face;
  if (a.y >= a.x && a.y >= a.z) {
    uv = d.xz / a.y;
    face = d.y > 0.0 ? 0.0 : 1.0;
  } else if (a.x >= a.z) {
    uv = d.zy / a.x;
    face = d.x > 0.0 ? 2.0 : 3.0;
  } else {
    uv = d.xy / a.z;
    face = d.z > 0.0 ? 4.0 : 5.0;
  }
  return floor(uv * 200.0) + vec2(face * 500.0, 0.0);
}

void main() {
  vec3 col = skyColor(vDir);
  vec2 cell = starCell(vDir);
  float star = step(0.995, hash(cell)) * smoothstep(0.08, 0.35, aboveHorizon(vDir));
  float twinkle = 0.6 + 0.4 * sin(time * 2.0 + hash(cell + 1.0) * 6.28);
  col += vec3(0.9, 0.95, 1.0) * star * twinkle * 0.8;
  gl_FragColor = vec4(col, 1.0);
}
`;

// The wall ribbon carries its distance along the outline in uv.x so the hex pattern tiles evenly
// around any shape.
export const WALL_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorld;
varying float vArc;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  vArc = uv.x;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// The play boundary: a hex mesh that only appears near the camera: within revealDistance across,
// and within a few metres of your feet up and down, so it shows at whatever height you're at.
export const WALL_FRAGMENT = `
precision highp float;
varying vec3 vWorld;
varying float vArc;
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
  vec2 uv = vec2(vArc, vWorld.y);
  float line = hexLine(uv, 1.6, 0.06);
  float dist = length(vWorld.xz - cameraPos.xz);
  float reveal = 1.0 - smoothstep(2.0, revealDistance, dist); // fully lit only right at the wall
  float feet = cameraPos.y - ${EYE_HEIGHT.toFixed(2)};
  float heightFade = 1.0 - smoothstep(6.0, 14.0, abs(vWorld.y - feet));
  float pulse = 0.8 + 0.2 * sin(time * 3.0 + vWorld.y * 0.8);
  float alpha = line * reveal * heightFade * pulse;
  if (alpha <= 0.0) discard; // most of the ribbon, most of the time: skip the blend
  gl_FragColor = vec4(wallColor * (0.6 + 0.4 * reveal), alpha);
}
`;
