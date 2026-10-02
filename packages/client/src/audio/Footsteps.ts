// The sounds a body makes moving about: a step every STRIDE metres covered on the ground (so a
// boosted runner steps faster and a scoped one slower), a swoosh on leaving the ground going up,
// and on touching down a landing as hard as the fall was fast. Worked out from each player's
// position and whether they're grounded, frame to frame, so it's the same for everyone.
import { GRAVITY, type Vec3 } from '@world/shared';
import type { Sfx, SoundId } from './Sfx';

const STEPS: SoundId[] = ['step-1', 'step-2', 'step-3', 'step-4'];
const STRIDE = 2.6; // metres between steps: about three a second at the 8 m/s walk
const JUMPED = 3; // metres moved in one frame that can only be a respawn or a correction
const RISE = 0.05; // metres up since leaving the ground that make it a jump, not a step off a ledge
// The landing for the fastest the player fell while airborne, in m/s, slowest first. A jump from
// flat ground lands at 8, a 10 m drop at 20; falls hurt from about 24.5.
const LANDINGS: { from: number; sound: SoundId }[] = [
  { from: 4, sound: 'land' },
  { from: 20, sound: 'land-hard' },
];

interface Walker {
  at: Vec3;
  grounded: boolean;
  walked: number; // metres since the last step
  step: number; // the last step played, so the next differs
  liftedFrom: number | null; // height their feet left the ground at, until it's called a jump or not
  peak: number; // highest they've been this time in the air
  falling: number; // fastest downward speed this time in the air, m/s, when it's known
}

export class Footsteps {
  private readonly walkers = new Map<string, Walker>();

  constructor(private readonly sfx: Sfx) {}

  // Everyone this frame: where they are, whether they're on the ground, how fast they're falling if
  // that's known (the local player's own sim), and `self` for the local player, whose sounds play
  // flat. Without a speed, a landing is judged by the drop from their highest point, which takes
  // no account of a jetpack braking the fall.
  update(players: { id: string; pos: Vec3; grounded: boolean; falling?: number; self: boolean }[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const w = this.walkers.get(p.id);
      if (!w) {
        this.walkers.set(p.id, {
          at: { ...p.pos },
          grounded: p.grounded,
          walked: 0,
          step: -1,
          liftedFrom: null,
          peak: p.pos.y,
          falling: 0,
        });
        continue;
      }
      const at = p.self ? null : p.pos;
      const across = Math.hypot(p.pos.x - w.at.x, p.pos.z - w.at.z);
      const down = w.at.y - p.pos.y;
      const wasGrounded = w.grounded;
      w.at = { ...p.pos };
      w.grounded = p.grounded;
      if (across > JUMPED || Math.abs(down) > JUMPED) continue;

      if (!p.grounded) {
        if (wasGrounded) {
          w.liftedFrom = p.pos.y + down;
          w.peak = w.liftedFrom;
          w.falling = 0;
        }
        w.peak = Math.max(w.peak, p.pos.y);
        w.falling = Math.max(w.falling, p.falling ?? 0);
        if (w.liftedFrom !== null && p.pos.y - w.liftedFrom > RISE) {
          this.sfx.play('jump', at);
          w.liftedFrom = null;
        } else if (down > 0) w.liftedFrom = null; // going down first: they stepped off something
        continue;
      }
      if (!wasGrounded) {
        const speed = p.falling === undefined ? Math.sqrt(2 * GRAVITY * Math.max(0, w.peak - p.pos.y)) : w.falling;
        const landing = LANDINGS.filter((l) => speed >= l.from).pop();
        if (landing) this.sfx.play(landing.sound, at);
        w.walked = 0;
      }
      w.walked += across;
      if (w.walked < STRIDE) continue;
      w.walked -= STRIDE;
      w.step = (w.step + 1 + Math.floor(Math.random() * (STEPS.length - 1))) % STEPS.length;
      this.sfx.play(STEPS[w.step], at);
    }
    for (const id of this.walkers.keys()) if (!seen.has(id)) this.walkers.delete(id);
  }
}
