// Luigi: 2.2 m of the taller brother, as Mario Kart 8's model stands beside Mario's (luigiModel.ts,
// made by scripts/jointed-model.py), a jointed body (Jointed.ts) on Mario's rig. He moves as Mario
// does, by the same clips drawn for his longer legs, but in the air his legs scuttle, running on
// the whole way up and down. Worn with /luigi; his hit capsule is AVATARS.luigi.hitbox.
import type { JointedSpec, Style } from './Jointed';
import { LUIGI_MODEL } from './luigiModel';
import { MARIO_STYLE } from './Mario';

export const LUIGI_STYLE: Style = { ...MARIO_STYLE, flutter: 3 };

export const LUIGI: JointedSpec = { kind: 'luigi', model: LUIGI_MODEL, style: LUIGI_STYLE, shadow: 1.2 };
