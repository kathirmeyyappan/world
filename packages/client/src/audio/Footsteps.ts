// Footsteps: a step every STRIDE metres a player covers on the ground, so a boosted runner steps
// faster and a scoped one slower, and nobody steps in the air. Each is one of STEPS, never the
// same twice running.
import type { Vec3 } from '@world/shared';
import type { Sfx, SoundId } from './Sfx';

const STEPS: SoundId[] = ['step-1', 'step-2', 'step-3', 'step-4'];
const STRIDE = 2.6; // metres between steps: about three a second at the 8 m/s walk
const JUMPED = 3; // metres moved in one frame that can only be a respawn or a correction, not a walk

export class Footsteps {
  private readonly walkers = new Map<string, { at: Vec3; walked: number; last: number }>();

  constructor(private readonly sfx: Sfx) {}

  // Everyone this frame: where they are, whether they're on the ground, and `self` for the local
  // player, whose steps play flat.
  update(players: { id: string; pos: Vec3; grounded: boolean; self: boolean }[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const w = this.walkers.get(p.id);
      if (!w) {
        this.walkers.set(p.id, { at: { ...p.pos }, walked: 0, last: -1 });
        continue;
      }
      const moved = Math.hypot(p.pos.x - w.at.x, p.pos.z - w.at.z);
      w.at = { ...p.pos };
      if (!p.grounded || moved > JUMPED) continue;
      w.walked += moved;
      if (w.walked < STRIDE) continue;
      w.walked -= STRIDE;
      const pick = (w.last + 1 + Math.floor(Math.random() * (STEPS.length - 1))) % STEPS.length;
      w.last = pick;
      this.sfx.play(STEPS[pick], p.self ? null : p.pos);
    }
    for (const id of this.walkers.keys()) if (!seen.has(id)) this.walkers.delete(id);
  }
}
