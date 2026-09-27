// Ties everything together for one session in one room: renders the world, predicts the local
// player, interpolates everyone else, and forwards input to the room host through a Connection.
import { Ray, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  CUBES, ITEMS, SKY_OBJECTS, TICK_DT, WORLD_SHAPE, actionForKey, createRng, findHit, hashSeed, itemHelp,
  type ItemId, type PlayerState, type ServerMessage,
} from '@world/shared';
import { InputManager } from '../input/InputManager';
import { MobileActions } from '../input/MobileActions';
import { MobileControls } from '../input/MobileControls';
import { IS_TOUCH } from '../input/touch';
import type { Connection } from '../net/Connection';
import { Interpolation } from '../net/Interpolation';
import { Prediction } from '../net/Prediction';
import { Avatar } from '../render/Avatar';
import { CubeMesh } from '../render/CubeMesh';
import { Engine } from '../render/Engine';
import { Environment } from '../render/Environment';
import { Viewmodel } from '../render/Weapons';
import { placeSkyObjects, type SkyObject } from '../render/SkyObject';
import { Bubble } from '../ui/Bubble';
import { Death } from '../ui/Death';
import { Hud } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { Overlay } from '../ui/Overlay';
import { Pins } from '../ui/Pins';

const MAX_TICKS_PER_FRAME = 5;
const CORRECTION_HALF_LIFE = 0.06;
const SNAP_DISTANCE = 3;
const PING_INTERVAL_MS = 2000;
const HOVER_RANGE = 400;
const DEFAULT_FOV = 1.2;
const SCOPED_FOV = 0.3;

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
  private readonly minimap = new Minimap(WORLD_SHAPE);
  private readonly death = new Death();
  private readonly viewmodel: Viewmodel;
  private dead = false;
  private scoped = false;
  private canHit = false;
  private lastScopeNag = -Infinity;
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
    this.environment = new Environment(this.engine, WORLD_SHAPE);
    this.camera = new UniversalCamera('camera', new Vector3(0, 1.7, 0), this.engine.scene);
    this.camera.minZ = 0.1;
    this.camera.fov = DEFAULT_FOV;
    this.engine.scene.activeCamera = this.camera;
    this.viewmodel = new Viewmodel(this.engine, this.camera);

    for (const sky of placeSkyObjects(this.engine, SKY_OBJECTS, WORLD_SHAPE, createRng(hashSeed(roomId)))) this.skyByMesh.set(sky.mesh.name, sky);

    CUBES.forEach((content) => {
      const cube = new CubeMesh(this.engine, content);
      this.cubes.set(content.id, cube);
      this.cubeByMesh.set(cube.mesh.name, cube);
    });

    this.input = new InputManager(canvas);
    this.mobile = new MobileControls(this.input);
    this.mobileActions = new MobileActions({
      onAction: () => this.select(),
      onScope: () => this.setScoped(!this.scoped),
      onChat: () => this.hud.openChat(),
    });
    this.hud = new Hud(roomId);
    this.hud.onChat = (text) => conn.send({ t: 'chat', text });
    this.hud.onChatOpenChange = (open) => {
      this.syncBlocked();
      // Sending or cancelling a message is a key press, so the browser lets us take the mouse
      // straight back rather than making the player click into the world again.
      if (!open && !IS_TOUCH && !this.isBlocked()) canvas.requestPointerLock?.();
    };
    window.addEventListener('keydown', (e) => {
      if (this.isBlocked() || e.repeat) return;
      if (e.code === 'KeyP') this.minimap.toggle();
      else if (this.held) {
        switch (actionForKey(this.held.id, e.code)) {
          case 'shoot': this.shoot(); break;
          case 'scope': this.setScoped(!this.scoped); break;
        }
      }
    });
    canvas.addEventListener('click', () => {
      // On touch a stray tap while turning must not fire; the FIRE button is the trigger there.
      if (this.isBlocked() || (IS_TOUCH && !this.hovered)) return;
      this.select();
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

  // What a click or the touch action button does: open the cube you're looking at, else shoot.
  private select(): void {
    if (this.hovered) this.overlay.show(this.hovered.content);
    else this.shoot();
  }

  private canFire(): boolean {
    return !!this.held && (!ITEMS[this.held.id].fireNeedsScope || this.scoped);
  }

  private shoot(): void {
    if (!this.canFire()) {
      // Trying to fire an unscoped sniper: say why nothing happened, but not on every press.
      if (this.held && performance.now() - this.lastScopeNag > 2000) {
        this.lastScopeNag = performance.now();
        this.hud.system(`the ${this.held.id} only fires while scoped${IS_TOUCH ? '' : ' (F)'}`);
      }
      return;
    }
    this.conn.send({ t: 'shoot', yaw: this.input.yaw, pitch: this.input.pitch, scoped: this.scoped });
    this.viewmodel.fire();
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
    return this.dead || this.overlay.isVisible() || this.hud.isChatOpen();
  }

  private syncBlocked(): void {
    this.input.setBlocked(this.isBlocked());
  }

  private handle(m: ServerMessage): void {
    const now = performance.now();
    switch (m.t) {
      case 'welcome': {
        this.myId = m.id;
        const me = m.players.find((p) => p.id === m.id)!;
        this.prediction = new Prediction(me, WORLD_SHAPE);
        this.input.yaw = me.yaw;
        this.input.pitch = me.pitch;
        this.interp.push(m.tick, m.players, m.cubes, now);
        this.hud.setSelf(m.id);
        this.hud.setPlayers(m.players);
        for (const p of m.players) if (p.id !== m.id) this.addAvatar(p);
        this.hud.system(IS_TOUCH
          ? `you are ${me.name}. drag to look, pad to move, SELECT on a cube.`
          : `you are ${me.name}. WASD to move, click cubes, Enter to chat.`);
        return;
      }
      case 'snap': {
        this.interp.push(m.tick, m.players, m.cubes, now);
        const me = m.players.find((p) => p.id === this.myId);
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
      case 'leave':
        this.avatars.get(m.id)?.dispose();
        this.avatars.delete(m.id);
        this.hud.removePlayer(m.id, m.name);
        return;
      case 'chat':
        this.hud.chat(m.name, m.color, m.text);
        return;
      case 'system':
        this.hud.system(m.text);
        return;
      case 'shot':
        if (m.id === this.myId && m.hit) this.hud.hitMarker();
        return;
      case 'kill':
        this.hud.setDead(m.victim);
        if (m.victim === this.myId) {
          this.dead = true;
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

  private addAvatar(p: PlayerState): void {
    if (this.avatars.has(p.id)) return;
    const avatar = new Avatar(this.engine, p.id, p.name, p.color);
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
      const frame = this.input.sampleFrame(this.prediction.nextSeq(), this.overlay.reading);
      this.prediction.apply(frame);
      this.conn.send({ t: 'input', f: frame });
    }

    const decay = Math.pow(0.5, dt / CORRECTION_HALF_LIFE);
    this.correction.scaleInPlace(decay);
    const p = this.prediction.state.pos;
    this.camera.position.set(p.x + this.correction.x, p.y + this.correction.y, p.z + this.correction.z);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);

    this.environment.update(dt, this.camera.position);
    const held = this.held;
    if (!held) this.setScoped(false);
    this.viewmodel.show(held && !this.scoped && !this.dead ? held.id : null);
    this.viewmodel.update(dt);
    this.hud.setItemHint(held && !this.dead ? itemHint(held.id, held.permanent ? null : held.left, !IS_TOUCH, this.scoped) : '');

    const sampled = this.interp.sample(performance.now(), this.myId);
    const readers = new Map<string, number>();
    const seen = new Set<string>();
    for (const rp of sampled.players) {
      seen.add(rp.id);
      let avatar = this.avatars.get(rp.id);
      if (!avatar) {
        avatar = new Avatar(this.engine, rp.id, rp.name, rp.color);
        this.avatars.set(rp.id, avatar);
      }
      avatar.update(rp);
      if (rp.reading) readers.set(rp.reading, (readers.get(rp.reading) ?? 0) + 1);
    }
    for (const [id, avatar] of this.avatars) if (!seen.has(id)) avatar.hide();
    this.pins.update(sampled.players, this.engine.scene, this.camera, this.canvasEl);
    this.bubble.update(this.engine.scene, this.camera, this.canvasEl);
    this.minimap.update({ me: { x: p.x, z: p.z, yaw: this.input.yaw }, players: sampled.players, cubes: sampled.cubes });

    this.updateHover();
    // Red crosshair when a shot from here would land: same maths the server will run.
    const me = this.prediction.state;
    const hit = held && !this.dead && this.canFire()
      ? findHit({ id: this.myId, pos: me.pos, yaw: this.input.yaw, pitch: this.input.pitch }, targets(sampled.players), ITEMS[held.id].range)
      : null;
    this.mobileActions.update({ hot: !!this.hovered, item: held?.id ?? null, scoped: this.scoped, canFire: this.canFire() });
    if (!!hit !== this.canHit) {
      this.canHit = !!hit;
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
      const hit = this.engine.scene.pickWithRay(ray, (mesh) => mesh.name.startsWith('cube-') || mesh.name.startsWith('sky-'));
      if (hit?.pickedMesh) {
        nextCube = this.cubeByMesh.get(hit.pickedMesh.name) ?? null;
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

  debug(): { id: string; pos: { x: number; y: number; z: number }; remotes: { id: string; name: string; x: number; z: number }[] } {
    const remotes = this.interp.sample(performance.now(), this.myId).players.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
    return { id: this.myId, pos: { ...(this.prediction?.state.pos ?? { x: 0, y: 0, z: 0 }) }, remotes };
  }


}

// The hint bar's text. A scope-only weapon leads with the step that's missing.
function itemHint(id: ItemId, left: number | null, withKeys: boolean, scoped: boolean): string {
  const parts = [id.toUpperCase()];
  if (ITEMS[id].fireNeedsScope && !scoped) parts.push(withKeys ? 'F to scope, then K or click to shoot' : 'scope to shoot');
  else if (withKeys) parts.push(itemHelp(id, ' · '));
  if (left !== null) parts.push(`${Math.ceil(left)}s`);
  return parts.join(' · ');
}

function targets(players: { id: string; x: number; y: number; z: number; dead: boolean }[]) {
  return players.map((p) => ({ id: p.id, pos: { x: p.x, y: p.y, z: p.z }, dead: p.dead }));
}
