// Where the camera's own feet are while a walker walks: not where the sim stands it, which goes up a
// flight of steps a step at a time, but along the line through the steps' nosings, so the eyes rise
// as evenly as the stair does and never drop under the step they are over. Easing up after each step
// would trail the feet by as much as a third of a metre at a full walk: under the step, for eyes
// lower than that.
import { STEP_UP, type Structures } from '@world/shared';

// Metres of ground averaged along the way the body walks: about a step's depth (the stairs helper
// keeps steps near 0.25 m high, about half a metre deep), over which the average of a flight is
// its nosing line.
const RIDE = 0.5;
const SAMPLES = 12;

// The ground the camera rides on at (x, z), for a body whose feet the sim has at `feet`, walking
// along `dir` (a unit vector across the floor): the ground averaged over RIDE metres on whichever
// side of the spot along `dir` is higher, less what a smooth slope adds to that average, and never
// under the ground at the spot itself. Over steps that is their nosing line, whichever way the
// body goes; on flat ground and up a ramp it is the ground.
export function rideGround(
  structures: Structures,
  x: number,
  z: number,
  dir: { x: number; z: number },
  feet: number,
): number {
  const reach = feet + STEP_UP; // a step the feet would climb, not a wall top beyond it
  const here = structures.footing(x, z, reach);
  let ahead = 0;
  let behind = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = ((i + 0.5) / SAMPLES) * RIDE;
    ahead += structures.groundAt(x + dir.x * t, z + dir.z * t, reach);
    behind += structures.groundAt(x - dir.x * t, z - dir.z * t, reach);
  }
  // A slope rising s metres a metre adds s * RIDE / 2 to the average on its uphill side.
  const slope = Math.abs(here.slope.x * dir.x + here.slope.z * dir.z);
  return Math.max(here.y, Math.max(ahead, behind) / SAMPLES - (slope * RIDE) / 2);
}
