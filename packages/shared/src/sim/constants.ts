export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const WORLD_RADIUS = 50;
export const PLAYER_PADDING = 1;

export const EYE_HEIGHT = 1.7;
export const MOVE_SPEED = 8;
export const GRAVITY = 20;
export const JUMP_VELOCITY = 8;
export const MAX_PITCH = Math.PI / 2 - 0.1;

// How far behind the newest snapshot remote players are rendered. Higher hides jitter, costs latency.
export const INTERP_DELAY_TICKS = 3;
// Inputs a server tick will consume from one player's queue. >1 lets a lagging client catch up.
export const MAX_INPUTS_PER_TICK = 3;
export const MAX_INPUT_QUEUE = TICK_RATE;

export const CUBE_BASE_Y = 3;
export const CUBE_FLOAT_AMPLITUDE = 0.3;
export const CUBE_BOUNDARY = 8;
export const CUBE_MIN_CENTER_DISTANCE = 10;
export const CUBE_MIN_SPACING = 8;

export const MAX_PLAYERS = 32;
export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 140;
export const MAX_ROOM_ID_LENGTH = 24;

export const PLAYER_COLORS = [
  '#64b5f6', '#f06292', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1',
  '#fff176', '#ff8a65', '#a1887f', '#90a4ae', '#e57373', '#aed581',
];
