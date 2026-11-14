// GLSL for the environment. Kept in one place so the ground, sky and boundary share helpers.
import { EYE_HEIGHT, OUTSIDE_HEIGHT } from '@world/shared';
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

// How bright a surface bent out of the level is, from its normal: 1 level, darker as it tips, and
// lighter on the slopes facing RELIEF_LIGHT than on those facing away, so a ridge reads as one.
// GroundRipple.ts shades a structure's top the same way on the CPU (reliefShade there).
export const RELIEF_LIGHT = { x: 0.6, z: -0.8 }; // level, unit length
export const RELIEF_TILT = 0.9; // darkening from level to a slope of 45 degrees, about
export const RELIEF_SIDE = 0.9; // the difference between a slope facing the light and one facing away
const RELIEF_SHADE = `
float reliefShade(vec3 n) {
  return max(0.0, 1.0 - ${RELIEF_TILT.toFixed(2)} * (1.0 - n.y) + ${RELIEF_SIDE.toFixed(2)} * dot(n.xz, vec2(${RELIEF_LIGHT.x.toFixed(2)}, ${RELIEF_LIGHT.z.toFixed(2)})));
}
`;

export const GROUND_VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
uniform mat4 worldViewProjection;
uniform mat4 world;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = mat3(world) * normal;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// Signed distance to the world's edge, mirroring worldDistance() in shared: discs are (x, z, r),
// bridges are (ax, az, bx, bz) with a half width, and sectors are (x, z, r) with the bearings
// between their sides. Counts are capped so the loops stay constant.
export const MAX_DISCS = 8;
export const MAX_BRIDGES = 8;
export const MAX_SECTORS = 2;
export const WORLD_SDF = `
uniform vec3 discs[${MAX_DISCS}];
uniform vec4 bridges[${MAX_BRIDGES}];
uniform float bridgeWidths[${MAX_BRIDGES}];
uniform vec3 sectors[${MAX_SECTORS}];
uniform vec2 sectorSpans[${MAX_SECTORS}];
uniform int discCount;
uniform int bridgeCount;
uniform int sectorCount;

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 v = b - a;
  float t = clamp(dot(p - a, v) / max(dot(v, v), 1.0e-6), 0.0, 1.0);
  return length(p - (a + v * t));
}

float worldDistance(vec2 p) {
  float d = 1.0e9;
  for (int i = 0; i < ${MAX_DISCS}; i++) {
    if (i >= discCount) break;
    d = min(d, length(p - discs[i].xy) - discs[i].z);
  }
  for (int i = 0; i < ${MAX_BRIDGES}; i++) {
    if (i >= bridgeCount) break;
    d = min(d, segmentDistance(p, bridges[i].xy, bridges[i].zw) - bridgeWidths[i]);
  }
  for (int i = 0; i < ${MAX_SECTORS}; i++) {
    if (i >= sectorCount) break;
    vec2 c = sectors[i].xy;
    float r = sectors[i].z;
    vec2 span = sectorSpans[i];
    vec2 q = p - c;
    bool within = mod(atan(q.y, q.x) - span.x, 6.2831853) <= span.y - span.x;
    float edge = min(
      segmentDistance(p, c, c + r * vec2(cos(span.x), sin(span.x))),
      segmentDistance(p, c, c + r * vec2(cos(span.y), sin(span.y)))
    );
    if (within) edge = min(edge, abs(length(q) - r));
    d = min(d, within && length(q) <= r ? -edge : edge);
  }
  return d;
}
`;

// Metres past the world's edge the kerb's outer face stands, clear of the boundary wall on the edge
// itself.
export const STEP_GAP = 0.02;
// The kerb along the edge (render/Environment.ts): metres across, inside the edge, and up. The floor
// and the ground past the edge each stop halfway across under it, so neither's cut edge shows. It
// lies inside the margin players are kept in by (PLAYER_PADDING), so no foot reaches it.
export const KERB_WIDTH = 0.5;
export const KERB_HEIGHT = 0.08;

// Two-scale grid, anti-aliased with screen-space derivatives, fading with distance into the sky's
// colour in that direction, so the floor meets the horizon wherever you're standing. It's drawn as
// three parts of the world's edge (side): the floor inside it, the ground past it OUTSIDE_HEIGHT
// down, and the kerb between them; past the edge the grid dims and turns grey, and the kerb is drawn
// as a bold line of the grid along the top of the drop (green on its top, grey down the face) and
// along its toe at the foot (grey), so where you can't go reads from afar. The
// kerb's outer face, the drop, carries the grid on down from the floor to the ground below
// (surfaceGridLine).
export const GROUND_FRAGMENT = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
uniform float side; // 0 the floor, 1 the ground past the edge, 2 the kerb
uniform vec3 cameraPos;
uniform vec3 lineColor;
uniform vec3 majorColor;
uniform vec3 floorColor;
uniform vec3 fogColor;
uniform float fogScale; // 1 normally, small while scoped so the far end is visible
uniform float time;
// A patch of the floor bent into ripples (render/GroundRipple.ts): shaded by its slope, as if lit
// low from one side, and glowing reliefGlow toward its crests, reliefHeight over reliefBase.
// 0 everywhere else, where the floor is flat.
uniform float relief;
uniform float reliefBase;
uniform float reliefHeight;
uniform vec3 reliefGlow;
${WORLD_SDF}
${SKY_GRADIENT}

float gridLine1(float v, float spacing, float width) {
  float g = abs(fract(v / spacing - 0.5) - 0.5) * spacing;
  float fw = fwidth(v) * 1.2;
  return 1.0 - smoothstep(width - fw, width + fw, g);
}

float gridLine(vec2 p, float spacing, float width) {
  return max(gridLine1(p.x, spacing, width), gridLine1(p.y, spacing, width));
}

// The grid on any surface, from its world position and its mesh's normal there (interpolated, so
// it turns smoothly over a curve and the family switches along one clean line; a normal worked out
// from the pixels' own slopes is noisy enough near halfway to flip back and forth): of the three
// axes, the one the normal lies nearest picks the grid (a level surface the floor's lines across x and z; one facing most along x
// the lines across z and up; along z, across x and up), so one family of lines runs over each face
// and a curve switches family where it turns past halfway rather than showing two at once.
float surfaceGridLine(vec3 w, vec3 normal, float spacing, float width) {
  vec3 n = abs(normalize(normal));
  vec2 plane = n.y >= max(n.x, n.z) ? w.xz : n.x >= n.z ? w.zy : w.xy;
  return gridLine(plane, spacing, width);
}

${RELIEF_SHADE}

void main() {
  vec2 p = vWorld.xz;
  float dist = length(p - cameraPos.xz);
  float sd = worldDistance(p);
  if (side < 0.5 ? sd > ${-KERB_WIDTH / 2} : side < 1.5 && sd < ${-KERB_WIDTH / 2}) discard;
  // On the kerb: lit along both rims of the drop, the top with the band of the face under it and
  // the toe with the band over it, so the border reads as bold seen from above or from the drop;
  // its inner face the grid's colour; and the drop between them gridded.
  float lit = 0.0;
  float rim = 0.0;
  if (side > 1.5) {
    rim = step(sd, ${-KERB_WIDTH / 2}) * step(vWorld.y, ${(KERB_HEIGHT - 0.001).toFixed(3)});
    lit = (1.0 - rim) * max(step(${-KERB_WIDTH / 2}, vWorld.y), step(vWorld.y, ${(OUTSIDE_HEIGHT + KERB_HEIGHT + KERB_WIDTH / 2).toFixed(3)}));
  }
  float minor;
  float major;
  if (side > 1.5) {
    // The lit parts are drawn as a bold line of the grid, so they're its colour exactly.
    float drop = (1.0 - lit) * (1.0 - rim);
    minor = max(surfaceGridLine(vWorld, vNormal, 2.0, 0.045) * drop, lit);
    major = max(surfaceGridLine(vWorld, vNormal, 10.0, 0.09) * drop, lit);
  } else {
    minor = gridLine(p, 2.0, 0.045);
    major = gridLine(p, 10.0, 0.09);
  }
  float inside = 1.0 - smoothstep(-2.0, 6.0, sd);
  float pulse = 0.85 + 0.15 * sin(time * 1.5 - length(p) * 0.15);
  vec3 col = floorColor;
  col = mix(col, lineColor * pulse, minor * 0.55 * (0.4 + 0.6 * inside));
  col = mix(col, majorColor * pulse, major * 0.9 * (0.5 + 0.5 * inside));
  // Grey past the edge: the ground there and all of the kerb but its top, at the floor's edge.
  float outside = side > 1.5 ? 1.0 - step(${(KERB_HEIGHT - 0.001).toFixed(3)}, vWorld.y) : side > 0.5 ? 1.0 : 0.0;
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), outside);
  col = mix(col, lineColor * 0.45, rim);
  if (relief > 0.5) {
    vec3 n = normalize(vNormal);
    col *= reliefShade(n);
    col += reliefGlow * clamp((vWorld.y - reliefBase) / reliefHeight, 0.0, 1.0);
  }
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
