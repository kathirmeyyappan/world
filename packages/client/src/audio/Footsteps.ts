// The sounds a body makes moving about: a step every stride covered on the ground (so a boosted
// runner steps faster and a scoped one slower), a swoosh on leaving the ground going up, and on
// touching down a landing as hard as the fall was fast. Worked out from each player's position and
// whether they're grounded, frame to frame, so it's the same for everyone. Each avatar's gait
// (render/avatars/gaits.ts) sets its stride, what its steps are and how heavy it sounds, and paces
// its limbs too (phase).
import { GRAVITY, type AvatarId, type Vec3 } from '@world/shared';
import { GAITS } from '../render/avatars/gaits';
import type { Sfx, SoundId } from './Sfx';

const THUDS: SoundId[] = ['step-1', 'step-2', 'step-3', 'step-4']; // a different one each step
const MOVING = 0.01; // metres along the ground in one frame that keep a step loop going
const JUMPED = 3; // metres moved in one frame that can only be a respawn or a correction
// Your own movement plays at this share of its volume, under other people's, so theirs stand out.
const SELF = 0.6;
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
  stride: number; // metres between their steps, for the body they wear
  walked: number; // metres since the last step
  step: number; // the last step played, so the next differs
  footfalls: number; // steps taken since they last landed: which foot is down
  liftedFrom: number | null; // height their feet left the ground at, until it's called a jump or not
  peak: number; // highest they've been this time in the air
  falling: number; // fastest downward speed this time in the air, m/s, when it's known
}

export class Footsteps {
  private readonly walkers = new Map<string, Walker>();

  constructor(private readonly sfx: Sfx) {}

  // Where a player is in their stride: 0 at a footfall of one foot, 1 at the other's, and back to
  // 0 at the first's again, so it runs 0 to 2 over a full swing of the legs.
  phase(id: string): number {
    const w = this.walkers.get(id);
    return w ? (w.footfalls % 2) + w.walked / w.stride : 0;
  }

  // Everyone this frame: where they are, what they look like, whether they're on the ground, how
  // fast they're falling if that's known (the local player's own sim), and `self` for the local
  // player, whose sounds play flat. Without a speed, a landing is judged by the drop from their
  // highest point, which takes no account of a jetpack braking the fall. Returns the step loops
  // wanted this frame, for the Sfx's loops.
  update(
    players: { id: string; pos: Vec3; avatar: AvatarId; grounded: boolean; falling?: number; self: boolean }[],
  ): { key: string; id: SoundId; at: Vec3 | null }[] {
    const seen = new Set<string>();
    const loops: { key: string; id: SoundId; at: Vec3 | null }[] = [];
    for (const p of players) {
      seen.add(p.id);
      const gait = GAITS[p.avatar];
      if (!gait) continue;
      const w = this.walkers.get(p.id);
      if (!w) {
        this.walkers.set(p.id, {
          at: { ...p.pos },
          grounded: p.grounded,
          stride: gait.stride,
          walked: 0,
          step: -1,
          footfalls: 0,
          liftedFrom: null,
          peak: p.pos.y,
          falling: 0,
        });
        continue;
      }
      const at = p.self ? null : p.pos;
      const level = p.self ? SELF : 1;
      const rate = gait.pitch;
      w.stride = gait.stride;
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
          this.sfx.play('jump', at, { level });
          w.liftedFrom = null;
        } else if (down > 0) w.liftedFrom = null; // going down first: they stepped off something
        continue;
      }
      if (!wasGrounded) {
        const speed = p.falling === undefined ? Math.sqrt(2 * GRAVITY * Math.max(0, w.peak - p.pos.y)) : w.falling;
        const landing = LANDINGS.filter((l) => speed >= l.from).pop();
        if (landing) this.sfx.play(landing.sound, at, { level, rate });
        w.walked = 0;
        w.footfalls = 0;
      }
      const steps = gait.steps;
      const loop = typeof steps === 'object' && 'loop' in steps ? steps.loop : null;
      if (loop && across > MOVING) loops.push({ key: p.id, id: loop, at });
      w.walked += across;
      if (w.walked < w.stride) continue;
      // A slow frame can cover more than one stride: every footfall counts, one sound plays.
      const falls = Math.floor(w.walked / w.stride);
      w.walked -= falls * w.stride;
      w.footfalls += falls;
      if (loop) continue;
      const bar = typeof steps === 'object' && 'bar' in steps ? steps.bar : null;
      w.step = bar
        ? (w.step + 1) % bar.length
        : (w.step + 1 + Math.floor(Math.random() * (THUDS.length - 1))) % THUDS.length;
      this.sfx.play(bar ? bar[w.step] : THUDS[w.step], at, { level, rate });
    }
    for (const id of this.walkers.keys()) if (!seen.has(id)) this.walkers.delete(id);
    return loops;
  }
}
