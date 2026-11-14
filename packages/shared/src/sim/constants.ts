export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const WORLD_RADIUS = 50;
export const PLAYER_PADDING = 1;
// Against structures: a player is a cylinder this wide around their eye, and climbs any top
// within STEP_UP of their feet (stairs, ramps); walking off an edge no more than STEP_DOWN lower
// keeps them on the ground rather than launching them off a slope.
export const PLAYER_RADIUS = 0.35;
export const STEP_UP = 0.5;
export const STEP_DOWN = 0.5;

export const EYE_HEIGHT = 1.7;
// The standard body's walk, m/s, and a jump's rise at a jump power of 1, metres: each look on foot
// walks at its own speed and jumps with its own power (avatars.ts `walk`, `jump`).
export const MOVE_SPEED = 8;
export const GRAVITY = 20;
export const JUMP_RISE = 1.6;
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_RISE); // the standard body's takeoff, m/s
// The fastest a walk slides across a slippery footing (sim/surfaces.ts), however steep the slope.
export const SLIDE_SPEED = 14;
// Ladders (structures.ts, walker.ts): how fast one is climbed, as a share of the climber's walk
// (avatars.ts `climbSpeedOf`); how far from one of its faces a walker facing it reaches to take
// hold, metres from the face to the body's middle; and how far off the face a climber's body stands.
export const CLIMB_SHARE = 2 / 3;
export const LADDER_REACH = 0.9;
export const LADDER_GAP = 0.05;
export const MAX_PITCH = Math.PI / 2 - 0.1;

// Running (the `run` action, held): the walk this many times as fast, except down a scope.
export const RUN_MULTIPLIER = 1.6;

// /speedy: temporary movement multiplier, counted down by the sim so prediction matches. A boosted
// walk gains nothing by running: the faster of the two multipliers applies, never both.
export const SPEEDY_MULTIPLIER = 1.6;
export const SPEEDY_SECONDS = 20;

// Aiming down a scope: walking at this fraction of the speed, and no jumping.
export const SCOPED_SPEED_MULTIPLIER = 0.3;

// Iced (items.ts, an item whose element is ice): chilled for CHILL_SECONDS from the last touch,
// walking at this fraction of the speed, counted down by the sim so prediction matches.
export const CHILL_SECONDS = 5;
export const CHILLED_SPEED_MULTIPLIER = 0.5;

// Shooting: hits are resolved on the server against each avatar's hit capsule (sim/avatars.ts).
// Ranges and cooldowns are per item, in items.ts.
export const DEATH_SCREEN_SECONDS = 10;

// How far behind the newest snapshot remote players are rendered. Higher hides jitter, costs latency.
export const INTERP_DELAY_TICKS = 3;
// How far back the server will rewind targets to judge a shot (lag compensation, rewind.ts).
// 8 ticks is ~267 ms: the 100 ms render delay plus a round trip of up to ~160 ms.
export const MAX_REWIND_TICKS = 8;
// Inputs a server tick will consume from one player's queue. >1 lets a lagging client catch up.
export const MAX_INPUTS_PER_TICK = 3;
export const MAX_INPUT_QUEUE = TICK_RATE;

export const CUBE_BASE_Y = 3;
export const CUBE_FLOAT_AMPLITUDE = 0.3;
export const CUBE_BOUNDARY = 8;
export const CUBE_MIN_CENTER_DISTANCE = 10;
export const CUBE_MIN_SPACING = 8;

export const MAX_PLAYERS = 64;
export const MAX_BOTS = 32;
export const MAX_NAME_LENGTH = 16;
// The least time between one player's renames: each is announced to the room, so this keeps a
// rename from being a way to spam the chat.
export const RENAME_SECONDS = 5;
export const MAX_CHAT_LENGTH = 140;
export const MAX_ROOM_ID_LENGTH = 24;

// The colours anyone can switch to with "/<name>" (commands.ts). Black is a dark grey, so a name label
// in it still reads against the night sky.
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  yellow: '#fff176',
  green: '#81c784',
  blue: '#64b5f6',
  pink: '#f06292',
  red: '#e57373',
  orange: '#ffb74d',
  brown: '#a1887f',
  purple: '#ba68c8',
  black: '#424242',
  white: '#f5f5f5',
};
