// The window at the top of the menu's PLAY tab: the player's own body, and the map (Map.ts) in a
// square in its corner, each named, the two swapping places at a click on the small one. The body is their
// avatar standing on a floor ruled in metres, or a dragon hovering over it, holding what they
// hold, drawn by the world's own avatar builders, so whatever a skin keeps moving while it stands
// still (a walker's `extra`, a dragon's wave and wings) moves here as in the world, and what the
// body has been through (frosted over, a crystal shot out) shows on it. The view turns slowly on
// its own and under a drag, from any side, above or below (the floor fades away as the view comes
// down to its level). The scene is a second Engine on a canvas of the card's, lit and finished like
// the world, built the first time the tab is seen and drawn only while it's seen.
import {
  ArcRotateCamera,
  Color3,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  type Mesh,
} from '@babylonjs/core';
import { AVATARS, EYE_HEIGHT, dragonShape, type AvatarId, type DragonState } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import { createAvatar, type Avatar } from '../../render/avatars';
import { Engine } from '../../render/Engine';
import type { Minimap } from '../Minimap';
import { MenuMap } from './Map';
import type { Me } from './tabs';

const PIXELS = 1.5; // CSS pixels per rendered one: the world's grid on a mouse device, whatever the picture is set to
const SPIN = 0.25; // radians a second the view turns on its own
const FROM = Math.PI / 2 - 0.6; // where the view starts: three quarters on, the body's right side and what it holds in view
const TILT = 0.35; // radians the view keeps off straight above and straight below
const SPIN_PAUSE_MS = 2500; // after a drag, before it turns on its own again
// The floor is ruled in squares a metre across, so bodies compare; it reaches REACH stages out from
// the middle, fading to nothing by its edge, and fades out altogether as the view comes down to its
// level, over this fraction of the view's distance in height.
const CELL = 1;
const REACH = 10;
const HORIZON_FADE = 0.12;
// A walker's stage: metres across, at least (a tall body gets a wider one), and how far off the
// view stands, in stages.
const WALKER_STAGE = 2.6;
const WALKER_HEADROOM = 1.3; // the stage this many times the body's height across
const WALKER_VIEW = 1.7;
// A body under SMALL_BODY metres (Plankton) would be a speck on the smallest stage, so it gets
// a stage SMALL_HEADROOM times its height across, a fraction of one of the floor's metre squares.
const SMALL_BODY = 0.5;
const SMALL_HEADROOM = 1.5;
// A dragon's, in its head's radius: it hovers HOVER radii up over a stage STAGE radii across.
const DRAGON_HOVER = 2.2;
const DRAGON_STAGE = 6;
const DRAGON_VIEW = 0.95; // in stages
// A hovering head's weave: metres either way and seconds a swing takes, across and up.
const WEAVE = { x: 0.6, y: 0.45, xSeconds: 7, ySeconds: 4.3 };
const BODY_ARC = 25; // metres: the radius of the curve a dragon's body is laid on behind its head

interface Stage {
  size: number; // metres across
  centre: Vector3; // what the view looks at: the middle of the body
  radius: number; // metres the view stands off
}

export class Preview {
  readonly el = document.createElement('div');
  private readonly body = document.createElement('div'); // the view of the body
  private readonly canvas = document.createElement('canvas');
  private readonly map: MenuMap;
  private mapBig = false; // the map fills the window and the body is in the corner
  private engine: Engine | null = null;
  private camera: ArcRotateCamera | null = null;
  private avatar: Avatar | null = null;
  private stage: (Stage & { floor: Mesh }) | null = null;
  private spine: number[] = []; // a dragon's, trailing its head (sim/dragon.ts DragonState)
  private dragging = false;
  private draggedAt = -Infinity;
  private seen = false; // drawn since it was last hidden: the first frame shown sizes the canvas
  private lastNow = performance.now();

  constructor(minimap: Minimap) {
    this.el.className = 'preview';
    this.map = new MenuMap(minimap);
    this.body.className = 'view body';
    this.body.append(this.canvas);
    // Each view is named: a title across its top while it fills the window, a caption under its
    // square while it's small, where it's a button to bring it up (the button covers the square, so
    // no drag reaches it).
    for (const [view, name] of [
      [this.body, 'PLAYER VIEW'],
      [this.map.el, 'MAP'],
    ] as const) {
      const swap = Object.assign(document.createElement('button'), { className: 'swap' });
      swap.append(Object.assign(document.createElement('span'), { className: 'caption', textContent: name }));
      swap.addEventListener('click', () => this.swap());
      view.append(Object.assign(document.createElement('span'), { className: 'title', textContent: name }), swap);
    }
    this.el.append(this.body, this.map.el);
    this.place();
    this.canvas.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => this.drop());
    window.addEventListener('pointercancel', () => this.drop());
  }

  // Once a frame: drawn while `visible`, as `me` is.
  sync(me: Me, visible: boolean): void {
    if (!visible) {
      this.seen = false;
      return;
    }
    const engine = this.engine ?? this.build();
    const now = performance.now();
    if (!this.seen) {
      engine.engine.resize();
      this.seen = true;
      this.lastNow = now;
    }
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const avatar = this.body3d(engine, me);
    const stage = this.stage!;
    avatar.update(this.state(me, stage, now), 0);
    const camera = this.camera!;
    if (!this.dragging && now - this.draggedAt > SPIN_PAUSE_MS) camera.alpha += dt * SPIN;
    // The floor goes as the view comes down to its level, and is gone from below it.
    const height = camera.position.y / (HORIZON_FADE * camera.radius);
    stage.floor.visibility = Math.min(1, Math.max(0, height));
    stage.floor.setEnabled(height > 0);
    this.map.sync();
    engine.scene.render();
  }

  private swap(): void {
    this.mapBig = !this.mapBig;
    this.place();
    this.engine?.engine.resize(); // the canvas is another size
  }

  private place(): void {
    this.body.classList.toggle('big', !this.mapBig);
    this.body.classList.toggle('small', this.mapBig);
    this.map.el.classList.toggle('big', this.mapBig);
    this.map.el.classList.toggle('small', !this.mapBig);
  }

  private drop(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.draggedAt = performance.now();
  }

  private build(): Engine {
    const engine = new Engine(this.canvas);
    engine.engine.setHardwareScalingLevel(PIXELS);
    const scene = engine.scene;
    // From in front of the body (it faces +z), a little above, turned by a drag or a pinch; never
    // slid about.
    const camera = new ArcRotateCamera('preview', FROM, 1.25, 4, new Vector3(0, 1, 0), scene);
    camera.minZ = 0.1;
    camera.panningSensibility = 0;
    camera.lowerBetaLimit = TILT;
    camera.upperBetaLimit = Math.PI - TILT;
    camera.wheelDeltaPercentage = 0.02;
    camera.pinchDeltaPercentage = 0.02;
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.attachControl(false); // the wheel zooms the view, not the card under it
    scene.activeCamera = camera;
    this.engine = engine;
    this.camera = camera;
    return engine;
  }

  // The avatar as `me` is, made afresh when the look or the colour changes, with the stage to
  // suit it.
  private body3d(engine: Engine, me: Me): Avatar {
    const old = this.avatar;
    if (old && (old.kind !== me.avatar || (old.color !== undefined && old.color !== me.color))) {
      old.dispose();
      this.avatar = null;
    }
    if (this.avatar) return this.avatar;
    this.avatar = createAvatar(engine, { id: 'preview', color: me.color, avatar: me.avatar });
    this.setStage(engine, me.avatar);
    return this.avatar;
  }

  private setStage(engine: Engine, kind: AvatarId): void {
    const stage = stageOf(kind);
    const camera = this.camera!;
    if (this.stage?.size !== stage.size) {
      this.stage?.floor.dispose(false, true);
      this.stage = { ...stage, floor: buildFloor(engine, stage.size) };
    } else {
      this.stage = { ...this.stage, ...stage };
    }
    camera.target.copyFrom(stage.centre);
    camera.radius = stage.radius;
    camera.lowerRadiusLimit = stage.radius * 0.6;
    camera.upperRadiusLimit = stage.radius * 1.6;
    if (AVATARS[kind].class === 'asian-dragon') this.spine = restingSpine(kind, stage.centre);
  }

  // The player as the avatar is posed from: standing still at the middle of the stage, facing
  // +z, holding what they hold; a dragon hovering there, its head weaving a little, the body
  // trailing wherever the head has pulled it.
  private state(me: Me, stage: Stage, now: number): RemotePlayer {
    const t = now / 1000;
    const dragon = AVATARS[me.avatar].class === 'asian-dragon';
    const at = dragon
      ? new Vector3(
          stage.centre.x + WEAVE.x * Math.sin((2 * Math.PI * t) / WEAVE.xSeconds),
          stage.centre.y + WEAVE.y * Math.sin((2 * Math.PI * t) / WEAVE.ySeconds),
          stage.centre.z,
        )
      : new Vector3(0, EYE_HEIGHT, 0);
    let body: DragonState | null = null;
    if (dragon) {
      trail(this.spine, at, dragonShape(me.avatar).links);
      // The head looks the way it's drifting, mostly ahead.
      const head = new Vector3(
        0.6 * WEAVE.x * Math.cos((2 * Math.PI * t) / WEAVE.xSeconds),
        0.6 * WEAVE.y * Math.cos((2 * Math.PI * t) / WEAVE.ySeconds),
        1,
      ).normalize();
      body = {
        dir: { x: 0, y: 0, z: 1 },
        speed: 0,
        head: { x: head.x, y: head.y, z: head.z },
        risen: true,
        spine: this.spine,
        shattered: me.shattered,
      };
    }
    return {
      id: 'preview',
      name: me.name,
      color: me.color,
      x: at.x,
      y: at.y,
      z: at.z,
      yaw: 0,
      pitch: 0,
      reading: null,
      item: me.item,
      firing: false,
      gear: me.gear,
      thrusting: false,
      walk: 0,
      climb: null,
      chilled: me.chilled,
      dead: false,
      avatar: me.avatar,
      dragon: body,
      bot: false,
      grounded: !dragon,
    };
  }
}

function stageOf(kind: AvatarId): Stage {
  if (AVATARS[kind].class === 'asian-dragon') {
    const r = dragonShape(kind).headRadius;
    const size = Math.ceil((r * DRAGON_STAGE) / CELL) * CELL;
    return { size, centre: new Vector3(0, r * DRAGON_HOVER, 0), radius: size * DRAGON_VIEW };
  }
  const { top } = AVATARS[kind].hitbox;
  const size =
    top < SMALL_BODY ? top * SMALL_HEADROOM : Math.ceil(Math.max(WALKER_STAGE, top * WALKER_HEADROOM) / CELL) * CELL;
  return { size, centre: new Vector3(0, top / 2, 0), radius: size * WALKER_VIEW };
}

// The floor: a plain ruled in the accent, a CELL to a square, solid over the stage in the middle
// and fading out to nothing by its edge, so it reads as going on for ever.
function buildFloor(engine: Engine, size: number): Mesh {
  const scene = engine.scene;
  const width = size * REACH;
  const floor = MeshBuilder.CreateGround('preview-floor', { width, height: width }, scene);
  floor.isPickable = false;
  floor.alphaIndex = 0; // drawn before the shadow and anything else translucent laid over it
  const ruled = new StandardMaterial('preview-floor', scene);
  const tile = gridTexture(engine);
  tile.uScale = tile.vScale = width / CELL;
  ruled.emissiveTexture = tile;
  ruled.opacityTexture = fadeTexture(engine);
  ruled.diffuseColor = Color3.Black();
  ruled.specularColor = Color3.Black();
  ruled.disableLighting = true;
  floor.material = ruled;
  return floor;
}

// One square of the floor: dark, ruled along its edges with half a line's width either side of each
// seam, so every edge rules alike as the tile repeats.
function gridTexture(engine: Engine): DynamicTexture {
  const size = 64;
  const texture = new DynamicTexture('preview-grid', size, engine.scene, true); // mipmapped: the far rules blend rather than sparkle
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE; // tiled across the floor
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(100, 181, 246, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const at of [0, size]) {
    ctx.moveTo(at, 0);
    ctx.lineTo(at, size);
    ctx.moveTo(0, at);
    ctx.lineTo(size, at);
  }
  ctx.stroke();
  texture.update();
  return texture;
}

// The floor's fade, read as alpha from its brightness: solid out to the stage's edge, thinning to
// nothing at the floor's.
function fadeTexture(engine: Engine): DynamicTexture {
  const size = 256;
  const texture = new DynamicTexture('preview-fade', size, engine.scene, true);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.getAlphaFromRGB = true;
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const fade = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, white] of [
    [0, 1],
    [1 / REACH, 1],
    [0.4, 0.72],
    [0.6, 0.42],
    [0.8, 0.16],
    [1, 0],
  ]) {
    const v = Math.round(white * 255);
    fade.addColorStop(at, `rgb(${v}, ${v}, ${v})`);
  }
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
}

// A dragon's spine at rest behind a head at `head` facing +z: its points their links apart
// along a gentle curve away to the right, so the body isn't a rod.
function restingSpine(kind: AvatarId, head: Vector3): number[] {
  const spine: number[] = [];
  let along = 0;
  for (const link of dragonShape(kind).links) {
    along += link;
    const turn = along / BODY_ARC;
    spine.push(head.x + BODY_ARC * (1 - Math.cos(turn)), head.y, head.z - BODY_ARC * Math.sin(turn));
  }
  return spine;
}

// Pulls each spine point to within its link of the one before it, the head first: how the sim
// keeps a body behind its head (sim/dragon.ts).
function trail(spine: number[], head: Vector3, links: readonly number[]): void {
  let lx = head.x;
  let ly = head.y;
  let lz = head.z;
  links.forEach((link, i) => {
    const k = i * 3;
    const dx = spine[k] - lx;
    const dy = spine[k + 1] - ly;
    const dz = spine[k + 2] - lz;
    const d = Math.hypot(dx, dy, dz);
    if (d > link) {
      const s = link / d;
      spine[k] = lx + dx * s;
      spine[k + 1] = ly + dy * s;
      spine[k + 2] = lz + dz * s;
    }
    lx = spine[k];
    ly = spine[k + 1];
    lz = spine[k + 2];
  });
}
