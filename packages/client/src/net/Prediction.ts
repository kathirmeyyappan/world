// Client-side prediction for the local player. Inputs are applied immediately with the shared sim
// and kept until the server acknowledges them; on each snapshot we rewind to the server's state
// and replay what it hasn't seen yet.
import { TICK_DT, clonePlayer, stepPlayer, type InputFrame, type PlayerState } from '@world/shared';

export class Prediction {
  state: PlayerState;
  private pending: InputFrame[] = [];
  private seq = 0;

  constructor(initial: PlayerState, private readonly worldRadius: number) {
    this.state = clonePlayer(initial);
  }

  nextSeq(): number {
    return ++this.seq;
  }

  apply(frame: InputFrame): void {
    stepPlayer(this.state, frame, TICK_DT, this.worldRadius);
    this.pending.push(frame);
  }

  // Returns how far the corrected position moved, so the caller can smooth the pop.
  reconcile(server: PlayerState): { dx: number; dy: number; dz: number } {
    this.pending = this.pending.filter((f) => f.seq > server.lastSeq);
    const next = clonePlayer(server);
    for (const f of this.pending) stepPlayer(next, f, TICK_DT, this.worldRadius);
    const delta = {
      dx: this.state.pos.x - next.pos.x,
      dy: this.state.pos.y - next.pos.y,
      dz: this.state.pos.z - next.pos.z,
    };
    this.state = next;
    return delta;
  }
}
