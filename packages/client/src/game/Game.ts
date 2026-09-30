// Ties everything together for one session in one room: renders the world, predicts the local
// player, interpolates everyone else, and forwards input to the room host through a Connection.
import { Ray, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  CUBES,
  ITEMS,
  LANDMARKS,
  SKY_OBJECTS,
  TICK_DT,
  WORLD_SHAPE,
  WORLD_STRUCTURES,
  actionForKey,
  createRng,
  hashSeed,
  itemHelp,
  itemStats,
  parseCommand,
  resolveFire,
  type ItemAction,
  type ItemId,
  type PlayerState,
  type ServerMessage,
} from '@world/shared';
import { InputManager } from '../input/InputManager';
import { MobileActions } from '../input/MobileActions';
import { MobileControls } from '../input/MobileControls';
import { IS_TOUCH } from '../input/touch';
import type { Connection } from '../net/Connection';
import { Interpolation } from '../net/Interpolation';
import { Prediction } from '../net/Prediction';
import { createAvatar, type Avatar } from '../render/avatars';
import { CubeMesh } from '../render/CubeMesh';
import { Engine } from '../render/Engine';
import { Environment } from '../render/Environment';
import { buildStructures } from '../render/Structures';
import { poof } from '../render/Poof';
import { Viewmodel } from '../render/Weapons';
import { placeSkyObjects, type SkyObject } from '../render/SkyObject';
import { AreaTitle } from '../ui/AreaTitle';
import { Bubble } from '../ui/Bubble';
import { CommandHint } from '../ui/CommandHint';
import { CommandsMenu } from '../ui/CommandsMenu';
import { DamageFlash } from '../ui/DamageFlash';
import { Death } from '../ui/Death';
import { Fuel } from '../ui/Fuel';
import { Hearts } from '../ui/Hearts';
import { HitNotice } from '../ui/HitNotice';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { Overlay } from '../ui/Overlay';
import { Pins } from '../ui/Pins';

const MAX_TICKS_PER_FRAME = 5;
const CORRECTION_HALF_LIFE = 0.06;
const STEP_EASE_HALF_LIFE = 0.05; // seconds for the camera to catch up with a step up or down
const SNAP_DISTANCE = 3;
const PING_INTERVAL_MS = 2000;
const HOVER_RANGE = 400; // sky objects can be read from anywhere
const CUBE_SELECT_RANGE = 25; // cubes only from close by, so a far one isn't opened by accident
const DEFAULT_FOV = 1.2;
const SCOPED_FOV = 0.3;
const SCOPED_FOG_SCALE = 0.05; // thin the fog while scoped so the sniper can see across the world
const HIP_KICK = 0.02;
const SCOPED_KICK = 0.035;
const KICK_HALF_LIFE = 0.06;
const MENU_SCROLL_PX = 80; // one arrow press or W/S on the commands menu

export class Game {
  private readonly engine: Engine;
  private readonly environment: Environment;
  private readonly camera: UniversalCamera;
  private readonly input: InputManager;
  private readonly mobile: MobileControls;
  private readonly mobileActions: MobileActions;
  private readonly overlay = new Overlay();
  private readonly hud: Hud;
  private readonly pins = new Pins();
  private readonly interp = new Interpolation();
  private readonly cubes = new Map<string, CubeMesh>();
  private readonly cubeByMesh = new Map<string, CubeMesh>();
  private readonly avatars = new Map<string, Avatar>();
  private readonly skyByMesh = new Map<string, SkyObject>();
  private readonly bubble = new Bubble();
  private readonly minimap = new Minimap(WORLD_SHAPE, LANDMARKS);
  private readonly death = new Death();
  private readonly hearts = new Hearts();
  private readonly fuel = new Fuel();
  private readonly commandHint = new CommandHint();
  private readonly areaTitle = new AreaTitle();
  private readonly commandsMenu = new CommandsMenu();
  private readonly damageFlash = new DamageFlash();
  private readonly hitNotice = new HitNotice();
  private readonly viewmodel: Viewmodel;
  private dead = false;
  private scoped = false;
  private canHit = false;
  private lastScopeNag = -Infinity;
  private shootWasHeld = false; // last frame's shoot level, for the press edge
  private mouseFiring = false; // the current mouse/FIRE hold started as a shot, not a select
  private mouseWasHeld = false;
  private localCooldownUntil = 0; // when the viewmodel may kick again; mirrors the server's cooldown
  private kick = 0; // camera recoil, radians of upward pitch that decays back
  private stepEase = 0; // metres the camera trails the predicted eye height after a step
  private hoveredSky: SkyObject | null = null;

  private prediction: Prediction | null = null;
  private myId = '';
  private accumulator = 0;
  private correction = new Vector3();
  private hovered: CubeMesh | null = null;
  private pingTimer = 0;

  constructor(
    private readonly canvasEl: HTMLCanvasElement,
    private readonly conn: Connection,
    roomId: string,
    private readonly onDisconnect: (reason: string) => void,
  ) {
    const canvas = canvasEl;
    this.engine = new Engine(canvas);
    this.environment = new Environment(this.engine, WORLD_SHAPE, WORLD_STRUCTURES.top);
    buildStructures(this.engine, WORLD_STRUCTURES.list);
    this.camera = new UniversalCamera('camera', new Vector3(0, 1.7, 0), this.engine.scene);
    this.camera.minZ = 0.1;
    this.camera.fov = DEFAULT_FOV;
    this.engine.scene.activeCamera = this.camera;
    this.viewmodel = new Viewmodel(this.engine, this.camera);

    CUBES.forEach((content) => {
      const cube = new CubeMesh(this.engine, content);
      this.cubes.set(content.id, cube);
      this.cubeByMesh.set(cube.mesh.name, cube);
    });

    this.input = new InputManager(canvas);
    this.mobile = new MobileControls(this.input);
    this.mobileActions = new MobileActions({
      // SELECT opens the cube under the crosshair; otherwise the button is the trigger, held.
      onActionDown: () => {
        if (this.hovered) this.overlay.show(this.hovered.content);
        else this.input.fireHeld = true;
      },
      onActionUp: () => (this.input.fireHeld = false),
      onScope: () => this.setScoped(!this.scoped),
      onChat: () => this.hud.openChat(),
      onCommands: () => this.commandsMenu.toggle(),
    });
    this.hud = new Hud(roomId);
    this.hud.onChat = (text) => {
      conn.send({ t: 'chat', text });
      if (parseCommand(text)) this.commandHint.markUsed(); // a command, even a bad one, means they know
    };
    this.hud.onChatOpenChange = (open) => {
      this.syncBlocked();
      // Sending or cancelling a message is a key press, so the browser lets us take the mouse
      // straight back rather than making the player click into the world again.
      if (!open && !IS_TOUCH && !this.isBlocked()) canvas.requestPointerLock?.();
    };
    window.addEventListener('keydown', (e) => {
      if (this.commandsMenu.isOpen) {
        // The menu is a little page: Q or C closes it (like the cube card), arrows and W/S scroll.
        if (e.code === 'KeyQ' || e.code === 'KeyC') this.commandsMenu.set(false);
        else if (e.code === 'ArrowDown' || e.code === 'KeyS') this.commandsMenu.scroll(MENU_SCROLL_PX);
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.commandsMenu.scroll(-MENU_SCROLL_PX);
        return;
      }
      if (this.isBlocked() || e.repeat) return;
      if (e.code === 'KeyP') this.minimap.toggle();
      else if (e.code === 'KeyC') this.commandsMenu.set(true);
      else if (this.held && actionForKey(this.held.id, e.code) === 'scope') this.setScoped(!this.scoped);
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.commandsMenu.isOpen) this.commandsMenu.scroll(e.deltaY);
      },
      { passive: true },
    );
    // Shooting is not a click handler: the input layer samples the mouse button into the
    // frame's actions like any key. A click only opens the cube under the crosshair, and only
    // when the press started on it: a hold that began as a shot stays a shot.
    canvas.addEventListener('click', () => {
      if (!this.isBlocked() && this.hovered && !this.mouseFiring) this.overlay.show(this.hovered.content);
    });

    conn.onMessage((m) => this.handle(m));
    conn.onClose((reason) => this.stop(reason));
  }

  start(): void {
    this.pingTimer = window.setInterval(() => this.conn.send({ t: 'ping', at: performance.now() }), PING_INTERVAL_MS);
    this.engine.run((dt) => this.frame(dt));
  }

  private stop(reason: string): void {
    clearInterval(this.pingTimer);
    this.mobile.dispose();
    this.engine.dispose();
    this.onDisconnect(reason);
  }

  private get held() {
    return this.prediction?.state.item ?? null;
  }

  private canFire(): boolean {
    return !!this.held && (!ITEMS[this.held.id].fireNeedsScope || this.scoped);
  }

  // The item actions to put in this tick's frame. Shoot is a level: key or mouse button down
  // (a press shorter than a tick still counts). A mouse press over a cube is a select, not a
  // shot; one that started clear of a cube keeps firing however the crosshair moves until
  // release. Scope is the local toggle, reported while on so the server's state follows it.
  private itemActions(): ItemAction[] {
    const mouse = this.input.fireHeld;
    if (mouse && !this.mouseWasHeld) this.mouseFiring = !this.hovered;
    if (!mouse) this.mouseFiring = false;
    this.mouseWasHeld = mouse;

    const held = this.held;
    if (!held || this.dead) return [];
    const spec = ITEMS[held.id];
    const actions: ItemAction[] = [];
    const shoot = spec.actions.shoot;
    const key = !!shoot && (this.input.isDown(shoot.key) || this.input.wasPressed(shoot.key));
    if (shoot && (key || this.mouseFiring)) actions.push('shoot');
    if (spec.actions.scope && this.scoped) actions.push('scope');
    this.localEffects(actions.includes('shoot'));
    return actions;
  }

  // What the local player sees on the press of a tap weapon, before the server confirms:
  // viewmodel recoil, camera kick, scope flash. Hold weapons show their jet from the sim's
  // firing state instead. An unscoped sniper explains itself.
  private localEffects(shootHeld: boolean): void {
    const pressed = shootHeld && !this.shootWasHeld;
    this.shootWasHeld = shootHeld;
    if (!pressed || !this.held) return;
    const spec = ITEMS[this.held.id];
    if (!this.canFire()) {
      if (performance.now() - this.lastScopeNag > 2000) {
        this.lastScopeNag = performance.now();
        this.hitNotice.note(`the ${this.held.id} only fires while scoped${IS_TOUCH ? '' : ' (F)'}`);
      }
      return;
    }
    if (spec.actions.shoot?.mode !== 'tap' || performance.now() < this.localCooldownUntil) return;
    this.localCooldownUntil = performance.now() + spec.cooldownTicks * TICK_DT * 1000;
    this.viewmodel.fire();
    // Recoil the camera up and let it settle. Bigger for the sniper, whose viewmodel is hidden
    // behind the scope, and flash the scope so the shot is unmistakable.
    this.kick = this.scoped ? SCOPED_KICK : HIP_KICK;
    if (this.scoped) {
      const scope = document.getElementById('scope')!;
      scope.classList.add('flash');
      setTimeout(() => scope.classList.remove('flash'), 90);
    }
  }

  // Aim down the scope: narrow the camera, slow the look, swap the viewmodel for the overlay.
  private setScoped(on: boolean): void {
    const can = !!this.held && 'scope' in ITEMS[this.held.id].actions;
    on = on && can;
    if (on === this.scoped) return;
    this.scoped = on;
    this.camera.fov = on ? SCOPED_FOV : DEFAULT_FOV;
    this.input.lookScale = on ? SCOPED_FOV / DEFAULT_FOV : 1;
    document.getElementById('scope')!.classList.toggle('hidden', !on);
  }

  private isBlocked(): boolean {
    return this.dead || this.overlay.isVisible() || this.hud.isChatOpen() || this.commandsMenu.isOpen;
  }

  private syncBlocked(): void {
    this.input.setBlocked(this.isBlocked());
  }

  private handle(m: ServerMessage): void {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        this.myId = m.id;
        // The sky is seeded by the room's key (the Modal session id), which welcome carries, so
        // everyone in a session shares one sky and a new session gets a new one.
        for (const sky of placeSkyObjects(this.engine, SKY_OBJECTS, WORLD_SHAPE, createRng(hashSeed(m.room))))
          this.skyByMesh.set(sky.mesh.name, sky);
        const me = m.players.find((p) => p.id === m.id)!;
        this.prediction = new Prediction(me, WORLD_SHAPE, WORLD_STRUCTURES);
        this.input.yaw = me.yaw;
        this.input.pitch = me.pitch;
        this.interp.push(m.tick, m.players, m.cubes, now);
        this.hud.setSelf(m.id);
        this.hud.setPlayers(m.players);
        for (const p of m.players) if (p.id !== m.id) this.addAvatar(p);
        this.hud.system(
          IS_TOUCH
            ? `you are ${me.name}. drag to look, pad to move, SELECT on a cube.`
            : `you are ${me.name}. WASD to move, click cubes, Enter to chat.`,
        );
        return;
      }
      case 'snap': {
        this.interp.push(m.tick, m.players, m.cubes, now);
        const me = m.players.find((p) => p.id === this.myId);
        if (me) this.hearts.set(me.hearts);
        this.hud.updateStats(m.players);
        if (me && this.prediction) {
          const d = this.prediction.reconcile(me);
          const dist = Math.hypot(d.dx, d.dy, d.dz);
          if (dist > SNAP_DISTANCE) this.correction.set(0, 0, 0);
          else if (dist > 1e-4) this.correction.addInPlace(new Vector3(d.dx, d.dy, d.dz));
        }
        return;
      }
      case 'join':
        this.addAvatar(m.p);
        this.hud.addPlayer(m.p);
        return;
      case 'leave': {
        const avatar = this.avatars.get(m.id);
        const corpse = avatar?.corpse();
        if (corpse) poof(this.engine, corpse);
        avatar?.dispose();
        this.avatars.delete(m.id);
        this.hud.removePlayer(m.id, m.name);
        return;
      }
      case 'chat':
        this.hud.chat(m.name, m.color, m.text);
        return;
      case 'system':
        this.hud.system(m.text);
        return;
      case 'shot':
        return;
      case 'hit':
        this.onHit(m);
        return;
      case 'kill':
        this.hud.announceKill(m.shooter, m.victim, m.item, m.headshot);
        this.hud.setDead(m.victim);
        if (m.victim === this.myId) {
          this.dead = true;
          this.commandHint.markUsed(); // they've been in a fight; no onboarding after the reload
          this.setScoped(false);
          this.syncBlocked();
          this.death.show(this.hud.playerName(m.shooter));
        }
        return;
      case 'pong':
        this.hud.setPing(now - m.at);
        return;
      case 'error':
        this.hud.system(m.message);
        return;
    }
  }

  // A shot landed. The victim's client flashes red and drops hearts, the shooter's says who
  // they hit, and everyone else sees the victim blink.
  private onHit(m: { shooter: string; victim: string; damage: number; headshot: boolean; hearts: number }): void {
    if (m.victim === this.myId) {
      this.damageFlash.flash();
      this.hearts.set(m.hearts);
    } else {
      this.avatars.get(m.victim)?.flash();
    }
    if (m.shooter === this.myId) {
      this.hud.hitMarker();
      this.hitNotice.show(this.hud.playerName(m.victim), m.damage, m.headshot);
    }
  }

  private addAvatar(p: PlayerState): void {
    if (this.avatars.has(p.id)) return;
    const avatar = createAvatar(this.engine, p);
    avatar.hide();
    this.avatars.set(p.id, avatar);
  }

  private frame(dt: number): void {
    if (!this.prediction) return;
    this.syncBlocked();
    this.input.update();

    this.accumulator += Math.min(dt, TICK_DT * MAX_TICKS_PER_FRAME);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const frame = this.input.sampleFrame(
        this.prediction.nextSeq(),
        this.overlay.reading,
        this.itemActions(),
        this.interp.viewTick,
      );
      this.stepEase -= this.prediction.apply(frame);
      this.conn.send({ t: 'input', f: frame });
    }

    const decay = Math.pow(0.5, dt / CORRECTION_HALF_LIFE);
    this.correction.scaleInPlace(decay);
    this.stepEase *= Math.pow(0.5, dt / STEP_EASE_HALF_LIFE);
    const p = this.prediction.state.pos;
    this.camera.position.set(p.x + this.correction.x, p.y + this.correction.y + this.stepEase, p.z + this.correction.z);
    this.kick *= Math.pow(0.5, dt / KICK_HALF_LIFE);
    if (this.kick < 1e-4) this.kick = 0;
    this.camera.rotation.set(this.input.pitch - this.kick, this.input.yaw, 0);

    this.environment.setVisibility(this.scoped ? SCOPED_FOG_SCALE : 1);
    this.environment.update(dt, this.camera.position);
    const held = this.held;
    if (!held) this.setScoped(false);
    this.viewmodel.show(held && !this.scoped && !this.dead ? held.id : null);
    const self = this.prediction.state;
    this.viewmodel.setFiring(self.firing);
    this.viewmodel.update(dt);
    this.hud.setItemHint(
      held && !this.dead ? itemHint(held.id, held.permanent ? null : held.left, !IS_TOUCH, this.scoped) : '',
      held ? itemStats(held.id) : '',
    );
    const fuelMax = held && ITEMS[held.id].fuelSeconds;
    this.fuel.set(held && fuelMax && held.fuel !== null && !this.dead ? held.fuel / fuelMax : null);
    this.commandHint.update(
      !!held || self.boost > 0 || self.avatar !== 'standard' || this.commandsMenu.everOpened,
      this.dead || this.hud.isChatOpen(),
    );

    const sampled = this.interp.sample(performance.now(), this.myId);
    const readers = new Map<string, number>();
    const seen = new Set<string>();
    for (const rp of sampled.players) {
      seen.add(rp.id);
      let avatar = this.avatars.get(rp.id);
      if (avatar && avatar.kind !== rp.avatar) {
        avatar.dispose();
        avatar = undefined;
      }
      if (!avatar) {
        avatar = createAvatar(this.engine, rp);
        this.avatars.set(rp.id, avatar);
      }
      avatar.update(rp);
      if (rp.reading) readers.set(rp.reading, (readers.get(rp.reading) ?? 0) + 1);
    }
    for (const [id, avatar] of this.avatars) if (!seen.has(id)) avatar.hide();
    this.pins.update(sampled.players, this.engine.scene, this.camera, this.canvasEl);
    this.bubble.update(this.engine.scene, this.camera, this.canvasEl);
    this.areaTitle.update(p.x, p.z);
    this.minimap.update({
      me: { x: p.x, y: p.y, z: p.z, yaw: this.input.yaw },
      players: sampled.players,
      cubes: sampled.cubes,
    });

    this.updateHover();
    // Red crosshair when a shot from here would land: same maths the server will run.
    const me = this.prediction.state;
    const hit =
      !!held &&
      !this.dead &&
      this.canFire() &&
      resolveFire(
        ITEMS[held.id],
        { id: this.myId, pos: me.pos, yaw: this.input.yaw, pitch: this.input.pitch },
        targets(sampled.players),
        WORLD_STRUCTURES,
      ).length > 0;
    this.mobileActions.update({
      hot: !!this.hovered,
      item: held?.id ?? null,
      scoped: this.scoped,
      canFire: this.canFire(),
    });
    if (hit !== this.canHit) {
      this.canHit = hit;
      this.hud.setCrosshairTarget(this.canHit);
    }
    for (const cs of sampled.cubes) {
      const cube = this.cubes.get(cs.id);
      if (!cube) continue;
      cube.setReaders(readers.get(cs.id) ?? 0);
      cube.update(cs);
    }
  }

  private updateHover(): void {
    let nextCube: CubeMesh | null = null;
    let nextSky: SkyObject | null = null;
    if (!this.isBlocked()) {
      const ray = new Ray(this.camera.position, this.camera.getForwardRay().direction, HOVER_RANGE);
      const hit = this.engine.scene.pickWithRay(
        ray,
        (mesh) => mesh.name.startsWith('cube-') || mesh.name.startsWith('sky-'),
      );
      // Structures aren't pickable; a cube or sky object behind one is hidden by it.
      const blocked =
        !!hit?.pickedMesh && WORLD_STRUCTURES.raycast(ray.origin, ray.direction, hit.distance) < hit.distance;
      if (hit?.pickedMesh && !blocked) {
        if (hit.distance <= CUBE_SELECT_RANGE) nextCube = this.cubeByMesh.get(hit.pickedMesh.name) ?? null;
        nextSky = this.skyByMesh.get(hit.pickedMesh.name) ?? null;
      }
    }
    if (nextCube !== this.hovered) {
      this.hovered?.setHovered(false);
      nextCube?.setHovered(true);
      this.hovered = nextCube;
    }
    if (nextSky !== this.hoveredSky) {
      this.hoveredSky?.setHovered(false);
      nextSky?.setHovered(true);
      this.hoveredSky = nextSky;
      if (nextSky) this.bubble.hover(nextSky.content.line, nextSky.anchor());
      else this.bubble.release();
    }
    this.hud.setCrosshairHot(!!nextCube || !!nextSky);
  }

  // Exposed for the end-to-end test.
  setLook(yaw: number, pitch = 0): void {
    this.input.yaw = yaw;
    this.input.pitch = pitch;
  }

  debug(): {
    id: string;
    pos: { x: number; y: number; z: number };
    remotes: { id: string; name: string; x: number; y: number; z: number }[];
    sky: { id: string; x: number; z: number }[];
  } {
    const remotes = this.interp
      .sample(performance.now(), this.myId)
      .players.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z }));
    const sky = [...this.skyByMesh.values()].map((s) => ({
      id: s.content.id,
      x: Math.round(s.mesh.position.x),
      z: Math.round(s.mesh.position.z),
    }));
    return { id: this.myId, pos: { ...(this.prediction?.state.pos ?? { x: 0, y: 0, z: 0 }) }, remotes, sky };
  }
}

// The hint bar's text. A scope-only weapon leads with the step that's missing.
function itemHint(id: ItemId, left: number | null, withKeys: boolean, scoped: boolean): string {
  const parts = [id.toUpperCase()];
  if (ITEMS[id].fireNeedsScope && !scoped)
    parts.push(withKeys ? 'F to scope, then K or click to shoot' : 'scope to shoot');
  else if (withKeys) parts.push(itemHelp(id, ' · '));
  if (left !== null) parts.push(`${Math.ceil(left)}s`);
  return parts.join(' · ');
}

function targets(players: { id: string; x: number; y: number; z: number; dead: boolean }[]) {
  return players.map((p) => ({ id: p.id, pos: { x: p.x, y: p.y, z: p.z }, dead: p.dead }));
}
