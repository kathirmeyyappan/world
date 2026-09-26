// Ties everything together for one session in one room: renders the world, predicts the local
// player, interpolates everyone else, and forwards input to the room host through a Connection.
import { Ray, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  CUBES, TICK_DT, WORLD_RADIUS,
  type PlayerState, type ServerMessage,
} from '@world/shared';
import { InputManager } from '../input/InputManager';
import { MobileControls } from '../input/MobileControls';
import type { Connection } from '../net/Connection';
import { Interpolation } from '../net/Interpolation';
import { Prediction } from '../net/Prediction';
import { Avatar } from '../render/Avatar';
import { CubeMesh } from '../render/CubeMesh';
import { Engine } from '../render/Engine';
import { Environment } from '../render/Environment';
import { Hud } from '../ui/Hud';
import { Overlay } from '../ui/Overlay';

const MAX_TICKS_PER_FRAME = 5;
const CORRECTION_HALF_LIFE = 0.06;
const SNAP_DISTANCE = 3;
const PING_INTERVAL_MS = 2000;
const HOVER_RANGE = 50;

export class Game {
  private readonly engine: Engine;
  private readonly camera: UniversalCamera;
  private readonly input: InputManager;
  private readonly mobile: MobileControls;
  private readonly overlay = new Overlay();
  private readonly hud: Hud;
  private readonly interp = new Interpolation();
  private readonly cubes = new Map<string, CubeMesh>();
  private readonly cubeByMesh = new Map<string, CubeMesh>();
  private readonly avatars = new Map<string, Avatar>();

  private prediction: Prediction | null = null;
  private myId = '';
  private accumulator = 0;
  private correction = new Vector3();
  private hovered: CubeMesh | null = null;
  private pingTimer = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly conn: Connection,
    roomId: string,
    private readonly onDisconnect: (reason: string) => void,
  ) {
    this.engine = new Engine(canvas);
    new Environment(this.engine, WORLD_RADIUS);
    this.camera = new UniversalCamera('camera', new Vector3(0, 1.7, 0), this.engine.scene);
    this.camera.minZ = 0.1;
    this.camera.fov = 1.2;
    this.engine.scene.activeCamera = this.camera;

    for (const content of CUBES) {
      const cube = new CubeMesh(this.engine, content);
      this.cubes.set(content.id, cube);
      this.cubeByMesh.set(cube.mesh.name, cube);
    }

    this.input = new InputManager(canvas);
    this.mobile = new MobileControls(this.input);
    this.hud = new Hud(roomId);
    this.hud.onChat = (text) => conn.send({ t: 'chat', text });
    this.hud.onChatOpenChange = () => this.syncBlocked();
    canvas.addEventListener('click', () => {
      if (this.hovered && !this.isBlocked()) this.overlay.show(this.hovered.content);
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

  private isBlocked(): boolean {
    return this.overlay.isVisible() || this.hud.isChatOpen();
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
        this.prediction = new Prediction(me, WORLD_RADIUS);
        this.input.yaw = me.yaw;
        this.input.pitch = me.pitch;
        this.interp.push(m.tick, m.players, m.cubes, now);
        this.hud.setSelf(m.id);
        this.hud.setPlayers(m.players);
        for (const p of m.players) if (p.id !== m.id) this.addAvatar(p);
        this.hud.system(`you are ${me.name}. WASD to move, click cubes, Enter to chat.`);
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

    this.updateHover();
    for (const cs of sampled.cubes) {
      const cube = this.cubes.get(cs.id);
      if (!cube) continue;
      cube.setReaders(readers.get(cs.id) ?? 0);
      cube.update(cs, dt);
    }
  }

  private updateHover(): void {
    let next: CubeMesh | null = null;
    if (!this.isBlocked()) {
      const ray = new Ray(this.camera.position, this.camera.getForwardRay().direction, HOVER_RANGE);
      const hit = this.engine.scene.pickWithRay(ray, (mesh) => mesh.name.startsWith('cube-'));
      if (hit?.pickedMesh) next = this.cubeByMesh.get(hit.pickedMesh.name) ?? null;
    }
    if (next !== this.hovered) {
      this.hovered?.setHovered(false);
      next?.setHovered(true);
      this.hovered = next;
      this.hud.setCrosshairHot(!!next);
    }
  }

  // Exposed for the end-to-end test.
  setYaw(yaw: number): void {
    this.input.yaw = yaw;
  }

  debug(): { id: string; pos: { x: number; y: number; z: number }; remotes: { id: string; name: string; x: number; z: number }[] } {
    const remotes = this.interp.sample(performance.now(), this.myId).players.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z }));
    return { id: this.myId, pos: { ...(this.prediction?.state.pos ?? { x: 0, y: 0, z: 0 }) }, remotes };
  }


}
