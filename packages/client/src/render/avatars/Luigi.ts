// Luigi: 2.2 m of the taller brother, as Mario Kart 8's model stands beside Mario's (luigiModel.ts,
// made by scripts/kart-model.py), a humanoid (Humanoid.ts) on Mario's rig. He moves as Mario does
// with longer legs and less certainty: a longer, springier stride, arms looser and further from
// his sides, a little more sway; and in the air his legs scuttle, kicking the whole way up and
// down, with his arms out to steady him. Worn with /luigi; his hit capsule is AVATARS.luigi.hitbox.
import type { HumanoidSpec } from './Humanoid';
import { LUIGI_MODEL } from './luigiModel';
import { MARIO_STYLE } from './Mario';
import { pose, type Stride, type Style } from './motion';

// Mario's stride at each pace, drawn for longer legs and a looser body.
const lanky = (s: Stride): Stride => ({
  ...s,
  step: s.step * 1.2,
  lift: s.lift * 1.15,
  bounce: s.bounce * 1.3,
  sway: s.sway * 1.8,
  rock: s.rock + 0.03,
  out: s.out + 0.08,
  elbow: s.elbow * 0.85,
  reach: s.reach * 1.1,
});

export const LUIGI_STYLE: Style = {
  ...MARIO_STYLE,
  strides: MARIO_STYLE.strides.map(lanky),
  // Arms out to the sides and bent, hands open, the trunk upright: the legs do the rest (the flutter).
  rise: pose({
    chest: { lean: -0.1 },
    head: { lean: -0.15 },
    armL: { swing: 0.5, out: 1.1, elbow: 1.0, in: 0.3 },
    armR: { swing: 0.5, out: 1.1, elbow: 1.0, in: 0.3 },
    footL: { y: 0.14 },
    footR: { y: 0.14 },
  }),
  fall: pose({
    chest: { lean: 0.12 },
    head: { lean: 0.12 },
    armL: { swing: 0.3, out: 1.75, elbow: 0.7 },
    armR: { swing: 0.3, out: 1.75, elbow: 0.7 },
    footL: { y: 0.14 },
    footR: { y: 0.14 },
  }),
  flutter: { hz: 6, reach: 0.2, lift: 0.1 },
};

export const LUIGI: HumanoidSpec = { kind: 'luigi', model: LUIGI_MODEL, style: LUIGI_STYLE, shadow: 1.2 };
