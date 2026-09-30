// Client-side prediction for the local player. Inputs are applied immediately with the shared sim
// and kept until the server acknowledges them; on each snapshot we rewind to the server's state
// and replay what it hasn't seen yet.
import {
  TICK_DT,
  clonePlayer,
  stepPlayer,
  type InputFrame,
  type PlayerState,
  type Structures,
  type WorldPart,
} from '@world/shared';

export class Prediction {
  state: PlayerState;
  private pending: InputFrame[] = [];
  private seq = 0;

  constructor(
    initial: PlayerState,
    private readonly shape: WorldPart[],
    private readonly structures: Structures,
  ) {
    this.state = clonePlayer(initial);
  }

  nextSeq(): number {
    return ++this.seq;
  }

  // Applies a local frame. Returns how far it moved the player up or down while they stayed on
  // the ground (a step or a slope), which the camera eases over rather than snapping.
  apply(frame: InputFrame): number {
    const before = this.state.pos.y;
    const standing = this.state.vy === 0;
    stepPlayer(this.state, frame, TICK_DT, this.shape, this.structures);
    this.pending.push(frame);
    return standing && this.state.vy === 0 ? this.state.pos.y - before : 0;
  }

  // Returns how far the corrected position moved, so the caller can smooth the pop.
  reconcile(server: PlayerState): { dx: number; dy: number; dz: number } {
    this.pending = this.pending.filter((f) => f.seq > server.lastSeq);
    const next = clonePlayer(server);
    for (const f of this.pending) stepPlayer(next, f, TICK_DT, this.shape, this.structures);
    const delta = {
      dx: this.state.pos.x - next.pos.x,
      dy: this.state.pos.y - next.pos.y,
      dz: this.state.pos.z - next.pos.z,
    };
    this.state = next;
    return delta;
  }
}
