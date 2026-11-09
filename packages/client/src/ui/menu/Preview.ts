// The player's own body at the top of the menu's PLAY tab: their avatar standing on a little
// stage, or a dragon hovering over it, holding what they hold, drawn by the world's own avatar
// builders, so whatever a skin keeps moving while it stands still (a walker's `extra`, a dragon's
// wave and wings) moves here as in the world. The view turns slowly on its own and under a drag.
// The scene is a second Engine on a canvas of the card's, lit and finished like the world, built
// the first time the tab is seen and drawn only while it's seen.
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DynamicTexture,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type Mesh,
} from '@babylonjs/core';
import { AVATARS, EYE_HEIGHT, dragonShape, type AvatarId, type DragonState } from '@world/shared';
import type { RemotePlayer } from '../../net/Interpolation';
import { createAvatar, type Avatar } from '../../render/avatars';
import { Engine } from '../../render/Engine';
import type { Me } from './tabs';

const PIXELS = 1.5; // CSS pixels per rendered one: the world's grid on a mouse device, whatever the picture is set to
const SPIN = 0.25; // radians a second the view turns on its own
const FROM = Math.PI / 2 - 0.6; // where the view starts: three quarters on, the body's right side and what it holds in view
const SPIN_PAUSE_MS = 2500; // after a drag, before it turns on its own again
const ACCENT = new Color3(0.39, 0.71, 0.96);
// A walker's stage: metres across its floor and cage, at least (a tall body gets a taller one),
// and how far off the view stands, in stages.
const WALKER_STAGE = 2.6;
const WALKER_HEADROOM = 1.3; // the cage this many times the body's height
const WALKER_VIEW = 1.7;
// A dragon's, in its head's radius: it hovers HOVER radii up in a cage CAGE radii across.
const DRAGON_HOVER = 2.2;
const DRAGON_CAGE = 6;
const DRAGON_VIEW = 0.95; // in cages
// A hovering head's weave: metres either way and seconds a swing takes, across and up.
const WEAVE = { x: 0.6, y: 0.45, xSeconds: 7, ySeconds: 4.3 };
const BODY_ARC = 25; // metres: the radius of the curve a dragon's body is laid on behind its head
const EDGE = 3; // the cage's edges, in Babylon's world-sized line width: a hair at a stage's distance, whatever its size

interface Stage {
  size: number; // metres across the floor and cage
  centre: Vector3; // what the view looks at: the middle of the body
  radius: number; // metres the view stands off
}

export class Preview {
  readonly el = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private engine: Engine | null = null;
  private camera: ArcRotateCamera | null = null;
  private avatar: Avatar | null = null;
  private stage: (Stage & { floor: Mesh; cage: Mesh }) | null = null;
  private spine: number[] = []; // a dragon's, trailing its head (sim/dragon.ts DragonState)
  private dragging = false;
  private draggedAt = -Infinity;
  private seen = false; // drawn since it was last hidden: the first frame shown sizes the canvas
  private lastNow = performance.now();

  constructor() {
    this.el.className = 'preview';
    this.el.append(this.canvas);
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
    const avatar = this.body(engine, me);
    const stage = this.stage!;
    avatar.update(this.state(me, stage, now), 0);
    if (!this.dragging && now - this.draggedAt > SPIN_PAUSE_MS) this.camera!.alpha += dt * SPIN;
    engine.scene.render();
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
    // slid about, never from underneath.
    const camera = new ArcRotateCamera('preview', FROM, 1.25, 4, new Vector3(0, 1, 0), scene);
    camera.minZ = 0.1;
    camera.panningSensibility = 0;
    camera.lowerBetaLimit = 0.35;
    camera.upperBetaLimit = 1.9;
    camera.wheelDeltaPercentage = 0.02;
    camera.pinchDeltaPercentage = 0.02;
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    camera.attachControl(true);
    scene.activeCamera = camera;
    this.engine = engine;
    this.camera = camera;
    return engine;
  }

  // The avatar as `me` is, made afresh when the look or the colour changes, with the stage to
  // suit it.
  private body(engine: Engine, me: Me): Avatar {
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
      this.stage?.cage.dispose(false, true);
      this.stage = { ...stage, ...buildStage(engine, stage.size) };
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
        shattered: [],
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
      chilled: false,
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
    const size = r * DRAGON_CAGE;
    return { size, centre: new Vector3(0, r * DRAGON_HOVER, 0), radius: size * DRAGON_VIEW };
  }
  const { top } = AVATARS[kind].hitbox;
  const size = Math.max(WALKER_STAGE, top * WALKER_HEADROOM);
  return { size, centre: new Vector3(0, top / 2, 0), radius: size * WALKER_VIEW };
}

// The stage: a floor ruled in the accent, and a glass cage over it with its edges drawn.
function buildStage(engine: Engine, size: number): { floor: Mesh; cage: Mesh } {
  const scene = engine.scene;
  const floor = MeshBuilder.CreateGround('preview-floor', { width: size, height: size }, scene);
  floor.isPickable = false;
  const ruled = new StandardMaterial('preview-floor', scene);
  ruled.emissiveTexture = floorTexture(engine);
  ruled.diffuseColor = Color3.Black();
  ruled.specularColor = Color3.Black();
  ruled.disableLighting = true;
  floor.material = ruled;
  const cage = MeshBuilder.CreateBox('preview-cage', { size }, scene);
  cage.position.y = size / 2;
  cage.isPickable = false;
  const glass = new StandardMaterial('preview-cage', scene);
  glass.emissiveColor = ACCENT;
  glass.diffuseColor = Color3.Black();
  glass.specularColor = Color3.Black();
  glass.disableLighting = true;
  glass.alpha = 0.04;
  glass.backFaceCulling = false;
  cage.material = glass;
  cage.enableEdgesRendering();
  cage.edgesWidth = EDGE;
  cage.edgesColor = new Color4(ACCENT.r, ACCENT.g, ACCENT.b, 0.7);
  return { floor, cage };
}

// Dark, with a grid of eight in the accent and a brighter rim.
function floorTexture(engine: Engine): DynamicTexture {
  const size = 128;
  const texture = new DynamicTexture('preview-floor', size, engine.scene, false);
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(100, 181, 246, 0.28)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const at = (i * size) / 8 + 0.5;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, size);
    ctx.moveTo(0, at);
    ctx.lineTo(size, at);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(100, 181, 246, 0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
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
