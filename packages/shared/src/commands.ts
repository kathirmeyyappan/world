// Chat commands: a message starting with "/" is parsed here and handled by the Room instead of
// being broadcast. Anyone seated can run them, bots included. Add a command by extending the
// union and the switch in Room.
export type Command = { name: 'speedy' };

export function parseCommand(text: string): Command | { name: 'unknown'; raw: string } | null {
  if (!text.startsWith('/')) return null;
  const [word] = text.slice(1).trim().split(/\s+/);
  switch (word.toLowerCase()) {
    case 'speedy':
      return { name: 'speedy' };
    default:
      return { name: 'unknown', raw: word };
  }
}
