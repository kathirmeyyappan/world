// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
import { isAvatarId, type AvatarId } from './sim/avatars';
import { isItemId, type ItemId } from './sim/items';

export type Command =
  | { name: 'speedy' }
  | { name: 'equip'; item: ItemId }
  | { name: 'avatar'; avatar: AvatarId }
  | { name: 'unknown'; raw: string };

const COMMAND_SHORTCUTS: Partial<Record<string, ItemId | 'speedy'>> = {
  g: 'gun',
  ft: 'flamethrower',
  s: 'speedy',
};

export function parseCommand(text: string): Command | null {
  if (!text.startsWith('/')) return null;

  const [raw] = text.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const normalized = COMMAND_SHORTCUTS[name] ?? name;

  if (normalized === 'speedy') return { name: 'speedy' };
  if (isItemId(normalized)) return { name: 'equip', item: normalized };
  if (isAvatarId(normalized)) return { name: 'avatar', avatar: normalized };
  return { name: 'unknown', raw };
}
