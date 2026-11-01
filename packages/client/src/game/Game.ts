// Ties everything together for one session in one room: renders the world, predicts the local
// player, interpolates everyone else, and forwards input to the room host through a Connection.
import { Ray, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  CUBES,
  GEAR,
  ITEMS,
  HIGH_LANDMARKS,
  LANDMARKS,
  SKY_OBJECTS,
  TICK_DT,
  WALL_FRAMES,
  WORLD_SHAPE,
  WORLD_STRUCTURES,
  actionForKey,
  actionHelp,
  classOf,
  createRng,
  hashSeed,
  isGrounded,
  itemHelp,
  itemStats,
  lookDirection,
  parseCommand,
  resolveFire,
  type ItemAction,
  type ItemId,
  type ItemState,
  type ClassSpec,
  type PlayerClass,
  type PlayerState,
  type ServerMessage,
  type Vec3,
  EYE_HEIGHT,
  MOVE_SPEED,
  eyeOf,
  statureOf,
} from '@world/shared';
import { Footsteps } from '../audio/Footsteps';
import { ACTION_SOUNDS, ITEM_SOUNDS, loopsOf, Sfx } from '../audio/Sfx';
import { InputManager } from '../input/InputManager';
import { MobileActions } from '../input/MobileActions';
import { MobileControls } from '../input/MobileControls';
import { IS_TOUCH } from '../input/touch';
import type { Connection } from '../net/Connection';
import { Interpolation, type RemotePlayer } from '../net/Interpolation';
import { Prediction } from '../net/Prediction';
import { createAvatar, preloadDragonModel, StandardAvatar, type Avatar } from '../render/avatars';
import { CubeMesh } from '../render/CubeMesh';
import { Engine } from '../render/Engine';
import { Environment } from '../render/Environment';
import { buildStructures } from '../render/Structures';
import { Pickups } from '../render/Pickups';
import { poof } from '../render/Poof';
import { WallFrames, type HungFrame } from '../render/WallFrames';
import { Viewmodel } from '../render/Weapons';
import { placeSkyObjects, type SkyObject } from '../render/SkyObject';
import { AreaTitle } from '../ui/AreaTitle';
import { Bubble } from '../ui/Bubble';
import { CommandHint } from '../ui/CommandHint';
import { CommandsMenu } from '../ui/CommandsMenu';
import { EdgeFlash } from '../ui/EdgeFlash';
import { Death } from '../ui/Death';
import { Fuel } from '../ui/Fuel';
import { GearHud } from '../ui/GearHud';
import { Hearts } from '../ui/Hearts';
import { HitNotice } from '../ui/HitNotice';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { Overlay } from '../ui/Overlay';
import { NameTags } from '../ui/NameTags';
import { Pins } from '../ui/Pins';
import { VIEWS, View, type Boom } from './View';

const MAX_TICKS_PER_FRAME = 5;
const CORRECTION_HALF_LIFE = 0.06;
const STEP_EASE_HALF_LIFE = 0.05; // seconds for the camera to catch up with a step up or down
const SNAP_DISTANCE = 3;
const PING_INTERVAL_MS = 2000;
const HOVER_RANGE = 400; // sky objects can be read from anywhere
const EYE_EASE = 0.25; // seconds the camera takes to settle at a new avatar's eye height and view
const CEILING_GAP = 0.15; // metres the camera keeps under a lintel or ceiling the body passes beneath
// A smaller body sees wider and a bigger one narrower, by its stature to this power: Mike's view
// is 5° wider than the standard body's and Tung Tung Tung's 5° narrower, enough to feel and no more.
const FOV_SHRINK = 0.15;
// Head bob: the eyes dip with each footfall, by this many metres at the standard body's full walk,
// in proportion to its stature, and in step with the footstep sounds. Small, so the view never
// swims and the crosshair stays where it was.
const BOB = 0.02;
const BOB_EASE = 0.15; // seconds the bob takes to come and go with the walk
const CUBE_SELECT_RANGE = 25; // cubes only from close by, so a far one isn't opened by accident
const FRAME_RANGE = 40; // metres from a frame you can read its line: the tower's width, wall to wall
const SCOPED_FOV = 0.3;
const SCOPED_FOG_SCALE = 0.05; // thin the fog while scoped so the sniper can see across the world
const HIP_KICK = 0.02;
const SCOPED_KICK = 0.035;
const KICK_HALF_LIFE = 0.06;
const MENU_SCROLL_PX = 80; // one arrow press or W/S on the commands menu
// Your own shots play at this share of their volume: right at your ear, they'd drown out the rest.
const OWN_SHOT = 0.7;
const NEAR_MISS_DELAY = 0.1; // seconds after the shot that a near miss whizzes by (about 4 frames)
const OWN_WEAPON_SCALE = 2.2; // your own guns, seen from the boom: at true size they read as toys
// A roar comes back off the world: the same again, this much later and this much quieter.
const ECHO_DELAY = 0.5;
const ECHO_LEVEL = 0.3;

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
  private readonly nameTags = new NameTags();
  private readonly interp = new Interpolation();
  private readonly cubes = new Map<string, CubeMesh>();
  private readonly cubeByMesh = new Map<string, CubeMesh>();
  private readonly avatars = new Map<string, Avatar>();
  private stature: number | null = null; // the worn avatar's size beside the standard one, eased over a change of look
  private readonly view = new View();
  private aim = { yaw: 0, pitch: 0 }; // the look sent this frame: the camera's, or in third person the eyes' at the crosshair's target
  private ownAvatar: Avatar | null = null; // the player's own body, drawn in third person
  private classId: PlayerClass | null = null; // the class the player was last seen as
  private readonly cried = new Set<string>(); // the dragons heard crying on their way out of the ground
  private bobbing = 0; // share of the full head bob in play: eased up with the walk and down when it stops
  private lastFeet: { x: number; z: number } | null = null; // where the predicted body was last frame, for its speed
  private readonly skyByMesh = new Map<string, SkyObject>();
  private readonly bubble = new Bubble();
  private readonly frameBubble = new Bubble('plain'); // a frame's line, over the frame
  private readonly wallFrames: WallFrames;
  private readonly minimap = new Minimap(WORLD_SHAPE, LANDMARKS, HIGH_LANDMARKS);
  private readonly death = new Death();
  private readonly hearts = new Hearts();
  private readonly fuel = new Fuel();
  private readonly gearHud = new GearHud();
  private readonly commandHint = new CommandHint();
  private readonly areaTitle = new AreaTitle();
  private readonly commandsMenu = new CommandsMenu();
  private readonly damageFlash = new EdgeFlash(document.getElementById('damage-flash')!, 160);
  private readonly healFlash = new EdgeFlash(document.getElementById('heal-flash')!, 900);
  private readonly hitNotice = new HitNotice();
  private readonly viewmodel: Viewmodel;
  private readonly pickups: Pickups;
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
  private hoveredFrame: HungFrame | null = null;
  private readonly sfx = new Sfx();
  private readonly footsteps = new Footsteps(this.sfx);
  // Other players' tap shots this tick, heard before the tick's snapshot says where they stood and
  // looked; `hitMe` once a hit on the local player from them comes in.
  private pendingShots: { shooter: string; hitMe: boolean }[] = [];

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
    preloadDragonModel();
    this.wallFrames = new WallFrames(this.engine, WALL_FRAMES);
    this.camera = new UniversalCamera('camera', new Vector3(0, 1.7, 0), this.engine.scene);
    this.camera.minZ = 0.1;
    this.camera.fov = VIEWS.walker.fov;
    this.engine.scene.activeCamera = this.camera;
    this.viewmodel = new Viewmodel(this.engine, this.camera);
    this.pickups = new Pickups(this.engine);

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
      else if (e.code === 'KeyO') toggleFullscreen();
      else if (e.code === 'KeyZ') this.view.toggle();
      else if (this.held && actionForKey(this.held.id, e.code) === 'scope') this.setScoped(!this.scoped);
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.commandsMenu.isOpen) this.commandsMenu.scroll(e.deltaY);
        else this.hoveredFrame?.scroll?.(e.deltaY); // a long widget, under the crosshair
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

    if (this.dead) return [];
    const actions: ItemAction[] = [];
    const held = this.held;
    if (held) {
      const spec = ITEMS[held.id];
      const shoot = spec.actions.shoot;
      const key = !!shoot && (this.input.isDown(shoot.key) || this.input.wasPressed(shoot.key));
      if (shoot && (key || this.mouseFiring)) actions.push('shoot');
      if (spec.actions.scope && this.scoped) actions.push('scope');
    }
    this.localEffects(actions.includes('shoot'));
    // Gear actions are holds, on their key (the jetpack's is the jump key, which the touch jump
    // button also holds down). The class's own are taps, reported as levels like the shot.
    const self = this.prediction?.state;
    if (self?.gear)
      for (const [action, spec] of Object.entries(GEAR[self.gear.id].actions))
        if (this.input.isDown(spec.key)) actions.push(action as ItemAction);
    if (self)
      for (const [action, spec] of Object.entries(classOf(self.avatar).actions))
        if (this.input.isDown(spec.key) || this.input.wasPressed(spec.key)) actions.push(action as ItemAction);
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
    this.ownAvatar?.fire();
    const shot = ITEM_SOUNDS[this.held.id].shot;
    if (shot) this.sfx.play(shot, null, { level: OWN_SHOT });
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
    this.camera.fov = on ? SCOPED_FOV : this.wornFov();
    this.input.lookScale = on ? SCOPED_FOV / this.wornFov() : 1;
    document.getElementById('scope')!.classList.toggle('hidden', !on);
  }

  // The view the worn avatar has when not scoped: its class's, and for a walker a little wider or
  // narrower by its stature.
  private wornFov(): number {
    const cls = this.prediction ? classOf(this.prediction.state.avatar) : null;
    return (cls ? VIEWS[cls.id].fov : VIEWS.walker.fov) * Math.pow(this.stature ?? 1, -FOV_SHRINK);
  }

  // The boom the camera hangs on in third person: the class's, scaled to a walker's stature.
  private boom(): Boom {
    const cls = classOf(this.prediction!.state.avatar);
    const { boom } = VIEWS[cls.id];
    const scale = cls.id === 'walker' ? (this.stature ?? 1) : 1;
    // A small body is no narrower across the shoulders than its gun arm reaches.
    return { back: boom.back * scale, right: boom.right * Math.max(1, scale), up: boom.up * scale };
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
        this.interp.push(m, now);
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
        this.interp.push(m, now);
        const me = m.players.find((p) => p.id === this.myId);
        if (me) {
          this.hearts.setLife(classOf(me.avatar));
          if (me.hearts > this.hearts.count && !this.dead) this.healFlash.flash();
          this.hearts.set(me.hearts);
        }
        this.hud.updateStats(m.players);
        this.hearShots(m.players);
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
        if (corpse) {
          poof(this.engine, corpse);
          this.sfx.play('hurt', corpse);
        }
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
        if (m.id !== this.myId) this.pendingShots.push({ shooter: m.id, hitMe: false });
        return;
      case 'action': {
        const sound = ACTION_SOUNDS[m.action];
        const at = this.headOf(m.id);
        if (sound && at) {
          this.sfx.play(sound, at);
          this.sfx.play(sound, at, { delay: ECHO_DELAY, level: ECHO_LEVEL });
        }
        (m.id === this.myId ? this.ownAvatar : this.avatars.get(m.id))?.act?.(m.action);
        return;
      }
      case 'hit':
        this.onHit(m);
        return;
      case 'kill':
        this.hud.announceKill(m.shooter, m.victim, m.item, m.headshot);
        this.hud.setDead(m.victim);
        if (m.victim === this.myId) this.die(`shot by ${this.hud.playerName(m.shooter)}`);
        return;
      case 'fell':
        this.hud.announceFall(m.victim);
        this.hud.setDead(m.victim);
        if (m.victim === this.myId) this.die('you fell');
        return;
      case 'pong':
        this.hud.setPing(now - m.at);
        return;
      case 'error':
        this.hud.system(m.message);
        return;
    }
  }

  // Where a player's head is right now: the local player's by prediction, anyone else's as drawn.
  private headOf(id: string): Vec3 | null {
    if (id === this.myId) return this.prediction?.state.pos ?? null;
    const p = this.interp.sample(performance.now(), this.myId).players.find((rp) => rp.id === id);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  // The local player died; `how` heads the death screen.
  private die(how: string): void {
    this.dead = true;
    this.commandHint.markUsed(); // they've been in a fight; no onboarding after the reload
    this.setScoped(false);
    this.syncBlocked();
    this.death.show(how);
  }

  // A shot landed, or with no shooter, a fall hurt. The victim's client flashes red, plays the
  // hurt sound and drops hearts, the shooter's says who they hit, and everyone else sees the
  // victim blink.
  private onHit(m: {
    shooter: string | null;
    victim: string;
    damage: number;
    headshot: boolean;
    hearts: number;
  }): void {
    if (m.victim === this.myId) {
      for (const s of this.pendingShots) if (s.shooter === m.shooter) s.hitMe = true;
      this.sfx.play('hurt');
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

  // This tick's tap shots, each played where its shooter stands. One that passed close to the
  // local player without hitting them also whizzes by a moment later, sweeping past from the
  // nearest point of its path (so the farther it passed, the quieter).
  private hearShots(players: PlayerState[]): void {
    for (const s of this.pendingShots) {
      const p = players.find((q) => q.id === s.shooter);
      const sounds = p?.item && ITEM_SOUNDS[p.item.id];
      if (!p || !sounds) continue;
      this.avatars.get(p.id)?.fire();
      if (sounds.shot) this.sfx.play(sounds.shot, p.pos);
      const whiz = s.hitMe ? undefined : sounds.nearMiss;
      const miss = whiz && this.closestPass(p);
      if (whiz && miss && miss.distance <= whiz.within) {
        const sound = whiz.sounds[Math.floor(Math.random() * whiz.sounds.length)];
        this.sfx.play(sound, miss.at, { delay: NEAR_MISS_DELAY, along: miss.along });
      }
    }
    this.pendingShots = [];
  }

  // Where a shot from `p` (from their eyes along their look, stopped by walls and its range) came
  // closest to the local player's eyes, how far from them, and which way it was going; null if it
  // never came level with them.
  private closestPass(p: PlayerState): { at: Vec3; distance: number; along: Vec3 } | null {
    const me = this.prediction?.state;
    if (!me || this.dead || !p.item) return null;
    const dir = lookDirection(p.yaw, p.pitch);
    const from = eyeOf(p);
    const ear = eyeOf(me);
    const range = ITEMS[p.item.id].range;
    const reach = Math.min(range, WORLD_STRUCTURES.raycast(from, dir, range));
    const along = (ear.x - from.x) * dir.x + (ear.y - from.y) * dir.y + (ear.z - from.z) * dir.z;
    if (along <= 0 || along > reach) return null;
    const at = { x: from.x + dir.x * along, y: from.y + dir.y * along, z: from.z + dir.z * along };
    return { at, distance: Math.hypot(at.x - ear.x, at.y - ear.y, at.z - ear.z), along: dir };
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
    const sampled = this.interp.sample(performance.now(), this.myId);
    // Off the eyes the camera's centre ray and theirs differ, so the look sent (the shot, the head's
    // turn) is the eyes' at what the crosshair is on, from where the camera was last frame.
    this.aim = this.view.aim(
      eyeOf(this.prediction.state),
      this.camera.position,
      this.input.yaw,
      this.input.pitch,
      this.myId,
      targets(sampled.players),
      WORLD_STRUCTURES,
    );

    this.accumulator += Math.min(dt, TICK_DT * MAX_TICKS_PER_FRAME);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      const frame = this.input.sampleFrame(
        this.prediction.nextSeq(),
        this.overlay.reading,
        this.itemActions(),
        this.interp.viewTick,
      );
      frame.yaw = this.aim.yaw;
      frame.pitch = this.aim.pitch;
      this.stepEase -= this.prediction.apply(frame);
      this.conn.send({ t: 'input', f: frame });
    }

    const decay = Math.pow(0.5, dt / CORRECTION_HALF_LIFE);
    this.correction.scaleInPlace(decay);
    this.stepEase *= Math.pow(0.5, dt / STEP_EASE_HALF_LIFE);
    const self = this.prediction.state;
    const p = self.pos;
    const eye = new Vector3(p.x + this.correction.x, p.y + this.correction.y + this.stepEase, p.z + this.correction.z);
    // The camera sits at the avatar's own eyes with its own width of view, easing there when the
    // look changes, and never up through a lintel or ceiling the body fits under.
    const worn = statureOf(self.avatar);
    this.stature = this.stature === null ? worn : this.stature + (worn - this.stature) * Math.min(1, dt / EYE_EASE);
    // A new class is seen its own way (a dragon from behind and above, by default) and has its own
    // keys.
    const cls = classOf(self.avatar).id;
    if (cls !== this.classId) {
      if (cls === 'dragon') this.view.set('third');
      this.hud.setKeys(cls);
      this.environment.setBounds(cls === 'dragon' ? 'sky' : 'ground');
      this.classId = cls;
    }
    const lift = (this.stature - 1) * EYE_HEIGHT; // metres the eyes are above the body's eye point
    if (!this.scoped) this.camera.fov = this.wornFov();
    // The bob follows the body's own speed across the ground, so it fades out against a wall and
    // stops in the air, down the scope and in death; its dip is deepest as each step lands.
    const speed = this.lastFeet && dt > 0 ? Math.hypot(p.x - this.lastFeet.x, p.z - this.lastFeet.z) / dt : 0;
    this.lastFeet = { x: p.x, z: p.z };
    const walking = !this.dead && !this.scoped && isGrounded(self) ? Math.sqrt(Math.min(1, speed / MOVE_SPEED)) : 0;
    this.bobbing += (walking - this.bobbing) * Math.min(1, dt / BOB_EASE);
    const dip =
      ((BOB * this.stature * this.bobbing) / 2) * (1 + Math.cos(2 * Math.PI * this.footsteps.phase(this.myId)));
    const room = lift > 0 ? Math.max(eye.y, WORLD_STRUCTURES.ceilingAt(eye.x, eye.z, eye.y) - CEILING_GAP) : Infinity;
    const eyes = new Vector3(eye.x, Math.min(eye.y + lift, room), eye.z);
    this.view.place(
      this.camera,
      eyes,
      dip,
      this.input.yaw,
      this.input.pitch,
      this.boom(),
      this.scoped,
      WORLD_STRUCTURES,
      dt,
    );
    this.kick *= Math.pow(0.5, dt / KICK_HALF_LIFE);
    if (this.kick < 1e-4) this.kick = 0;
    this.camera.rotation.set(this.input.pitch - this.kick, this.input.yaw, 0);

    this.environment.setVisibility(this.scoped ? SCOPED_FOG_SCALE : 1);
    this.environment.update(dt, eye);
    this.wallFrames.update(this.camera);
    const held = this.held;
    if (!held) this.setScoped(false);
    this.viewmodel.show(held && !this.scoped && !this.dead && this.view.atEyes ? held.id : null);
    this.viewmodel.setFiring(self.firing);
    this.viewmodel.update(dt);
    this.hud.setItemHint(
      held && !this.dead ? itemHint(held.id, !IS_TOUCH, this.scoped, classOf(self.avatar)) : '',
      held ? itemStats(held.id) : '',
    );
    const fuelMax = held && ITEMS[held.id].fuelSeconds;
    this.fuel.set(held && fuelMax && held.fuel !== null && !this.dead ? held.fuel / fuelMax : null);
    this.gearHud.set(this.dead ? null : self.gear);
    this.commandHint.update(
      !!held || !!self.gear || self.boost > 0 || self.avatar !== 'standard' || this.commandsMenu.everOpened,
      this.dead || this.hud.isChatOpen(),
    );

    const readers = new Map<string, number>();
    const seen = new Set<string>();
    for (const rp of sampled.players) {
      seen.add(rp.id);
      let avatar = this.avatars.get(rp.id);
      // A new look, or a new colour on the figure that wears it, is a new avatar.
      if (avatar && (avatar.kind !== rp.avatar || (avatar instanceof StandardAvatar && avatar.color !== rp.color))) {
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
    this.updateOwnAvatar({ x: eye.x, y: p.y + this.correction.y, z: eye.z }, held);
    this.pins.update(sampled.players, this.engine.scene, this.camera, this.canvasEl);
    this.nameTags.update(sampled.players, this.engine.scene, this.camera, this.canvasEl);
    this.bubble.update(this.engine.scene, this.camera, this.canvasEl);
    this.frameBubble.update(this.engine.scene, this.camera, this.canvasEl);
    this.areaTitle.update(p);
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
        { id: this.myId, pos: me.pos, yaw: this.aim.yaw, pitch: this.aim.pitch, avatar: me.avatar, dragon: me.dragon },
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
    this.sfx.listen(this.camera.position, this.input.yaw);
    const stepLoops = this.footsteps.update([
      {
        id: this.myId,
        pos: self.pos,
        avatar: self.avatar,
        grounded: !this.dead && isGrounded(self),
        falling: -self.vy,
        self: true,
      },
      ...sampled.players.map((rp) => ({
        id: rp.id,
        pos: { x: rp.x, y: rp.y, z: rp.z },
        avatar: rp.avatar,
        grounded: rp.grounded && !rp.dead,
        self: false,
      })),
    ]);
    // Every dragon rises out of the ground with a cry (kept trying until the recording has arrived,
    // and heard again from the same player's next one); the nearest living one's theme plays from
    // its head.
    const dragons = [
      ...(self.dragon && !this.dead ? [{ id: this.myId, at: self.pos, risen: self.dragon.risen }] : []),
      ...sampled.players.flatMap((rp) =>
        rp.dragon && !rp.dead ? [{ id: rp.id, at: { x: rp.x, y: rp.y, z: rp.z }, risen: rp.dragon.risen }] : [],
      ),
    ];
    for (const d of dragons) {
      if (d.risen) this.cried.delete(d.id);
      else if (!this.cried.has(d.id) && this.sfx.play('dragon-cry', d.at)) this.cried.add(d.id);
    }
    const ear = this.camera.position;
    const nearest = dragons.sort(
      (a, b) =>
        Vector3.Distance(ear, new Vector3(a.at.x, a.at.y, a.at.z)) -
        Vector3.Distance(ear, new Vector3(b.at.x, b.at.y, b.at.z)),
    )[0];
    this.sfx.setLoops([
      ...loopsOf({ ...self, item: self.item?.id ?? null, gear: self.gear?.id ?? null, dead: this.dead }).map((id) => ({
        key: this.myId,
        id,
        at: null,
      })),
      ...sampled.players.flatMap((rp) => loopsOf(rp).map((id) => ({ key: rp.id, id, at: rp }))),
      ...stepLoops,
      ...(nearest ? [{ key: 'dragon', id: 'dragon-theme' as const, at: nearest.at }] : []),
    ]);
    this.pickups.update(sampled.pickups);
    for (const cs of sampled.cubes) {
      const cube = this.cubes.get(cs.id);
      if (!cube) continue;
      cube.setReaders(readers.get(cs.id) ?? 0);
      cube.update(cs);
    }
  }

  // The player's own body: where prediction has it (its eye point `at`, corrected but not trailing a
  // step like the camera), turned to the look sent. Drawn in third person, and from the eyes only
  // where the body goes on behind them without the head (a dragon's).
  private updateOwnAvatar(at: Vec3, held: ItemState | null): void {
    const self = this.prediction!.state;
    let avatar = this.ownAvatar;
    if (avatar && (avatar.kind !== self.avatar || (avatar instanceof StandardAvatar && avatar.color !== self.color))) {
      avatar.dispose();
      avatar = null;
    }
    if (!avatar) {
      avatar = this.ownAvatar = createAvatar(this.engine, self);
      avatar.scaleWeapons(OWN_WEAPON_SCALE);
    }
    const own: Avatar = avatar;
    const shown = this.view.showsBody;
    if (!shown && !own.setHeadless) {
      own.hide();
      return;
    }
    own.setHeadless?.(!shown);
    own.update({
      id: self.id,
      name: self.name,
      color: self.color,
      x: at.x,
      y: at.y,
      z: at.z,
      yaw: this.aim.yaw,
      pitch: this.aim.pitch,
      reading: self.reading,
      item: held?.id ?? null,
      firing: self.firing,
      gear: self.gear?.id ?? null,
      thrusting: self.thrusting,
      dead: this.dead,
      avatar: self.avatar,
      dragon: self.dragon,
      bot: false,
      grounded: isGrounded(self),
    });
  }

  private updateHover(): void {
    let nextCube: CubeMesh | null = null;
    let nextSky: SkyObject | null = null;
    let nextFrame: HungFrame | null = null;
    if (!this.isBlocked()) {
      const ray = new Ray(this.camera.position, this.camera.getForwardRay().direction, HOVER_RANGE);
      const hit = this.engine.scene.pickWithRay(ray, (mesh) => /^(cube|sky|frame)-/.test(mesh.name));
      // Structures aren't pickable; anything behind one is hidden by it.
      const blocked =
        !!hit?.pickedMesh && WORLD_STRUCTURES.raycast(ray.origin, ray.direction, hit.distance) < hit.distance;
      if (hit?.pickedMesh && !blocked) {
        if (hit.distance <= CUBE_SELECT_RANGE) nextCube = this.cubeByMesh.get(hit.pickedMesh.name) ?? null;
        nextSky = this.skyByMesh.get(hit.pickedMesh.name) ?? null;
        if (hit.distance <= FRAME_RANGE) nextFrame = this.wallFrames.at(hit.pickedMesh.name);
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
    if (nextFrame) this.frameBubble.hover(nextFrame.frame.show.line, nextFrame.above);
    else if (this.hoveredFrame) this.frameBubble.release();
    this.hoveredFrame = nextFrame;
    this.hud.setCrosshairHot(!!nextCube || !!nextSky || !!nextFrame);
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

// The hint bar's text. A scope-only weapon leads with the step that's missing; a class with
// actions of its own (a dragon's roars) has them after the item's.
function itemHint(id: ItemId, withKeys: boolean, scoped: boolean, cls: ClassSpec): string {
  const parts = [id.toUpperCase()];
  if (ITEMS[id].fireNeedsScope && !scoped)
    parts.push(withKeys ? 'F to scope, then K or click to shoot' : 'scope to shoot');
  else if (withKeys) parts.push(itemHelp(id, ' · '));
  const own = withKeys ? actionHelp(cls.actions) : '';
  if (own) parts.push(own);
  return parts.join(' · ');
}

function targets(players: RemotePlayer[]) {
  return players.map((p) => ({
    id: p.id,
    pos: { x: p.x, y: p.y, z: p.z },
    dead: p.dead,
    avatar: p.avatar,
    dragon: p.dragon,
  }));
}

// The whole page, HUD included, so the browser's own Esc (or O again) comes back out.
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
