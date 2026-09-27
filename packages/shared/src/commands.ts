// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
import { isAvatarId, type AvatarId } from './sim/avatars';
import { isItemId, type ItemId } from './sim/items';

export type Command = { name: 'speedy' } | { name: 'equip'; item: ItemId } | { name: 'avatar'; avatar: AvatarId };

export function parseCommand(text: string): Command | { name: 'unknown'; raw: string } | null {
  if (!text.startsWith('/')) return null;
  const [word] = text.slice(1).trim().split(/\s+/);
  const lower = word.toLowerCase();
  if (lower === 'speedy') return { name: 'speedy' };
  if (isItemId(lower)) return { name: 'equip', item: lower }; // /gun, /sniper, ...
  if (isAvatarId(lower)) return { name: 'avatar', avatar: lower }; // /elizabeth, /standard
  return { name: 'unknown', raw: word };
}
