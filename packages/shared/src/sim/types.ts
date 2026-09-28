import type { AvatarId } from './avatars';
import type { ItemAction, ItemState } from './items';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// One player as the server sees them. `pos` is eye position, not feet.
export interface PlayerState {
  id: string;
  name: string;
  color: string;
  pos: Vec3;
  vy: number;
  yaw: number;
  pitch: number;
  lastSeq: number;
  reading: string | null;
  boost: number; // seconds of /speedy left, 0 when normal
  item: ItemState | null; // what they're holding, if anything
  scoped: boolean; // aiming down the sniper's scope (reported by the client, kept here so everyone sees it)
  firing: boolean; // a hold item is spraying this tick
  avatar: AvatarId; // how they look; cosmetic only
  avatarLocked: boolean; // the name chose the avatar; commands can't change it
  hearts: number; // MAX_HEARTS at spawn, down to 0 when shot enough
  kills: number; // players this one has finished off this life
  bot: boolean; // declared by the client at join; a headless player, shown as one, and never keeps a room open
  dead: boolean; // stays dead until they leave; a rejoin is a new player
}

// One tick of intent from a client. Look is client-authoritative; movement is not.
export interface InputFrame {
  seq: number;
  mx: number;
  my: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  reading: string | null;
  actions: ItemAction[]; // item actions held this tick (tap ones on the press, toggles while on)
}

export interface CubeState {
  id: string;
  pos: Vec3;
  rot: { x: number; y: number };
  target: { x: number; z: number };
  time: number;
  wanderSpeed: number;
  floatFrequency: number;
  rotationSpeed: number;
}
