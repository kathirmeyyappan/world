// A Connection is the client's one channel to a room host. Two implementations:
// WsConnection for a real server, LocalConnection for the offline mode that hosts a Room in-page.
import { Room, type ClientMessage, type ServerMessage } from '@world/shared';

export interface Connection {
  readonly kind: 'ws' | 'local';
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(): void;
}

export class WsConnection implements Connection {
  readonly kind = 'ws';
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private closeCb: ((reason: string) => void) | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (e) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(e.data);
      } catch {
        return;
      }
      this.messageCb?.(parsed);
    };
    ws.onclose = (e) => this.closeCb?.(e.reason || `connection closed (${e.code})`);
  }

  static connect(url: string, timeoutMs = 8000): Promise<WsConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('connection timed out'));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new WsConnection(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('could not reach the room server'));
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        reject(new Error(e.reason || `connection refused (${e.code})`));
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
  }
  onClose(cb: (reason: string) => void): void {
    this.closeCb = cb;
  }
  close(): void {
    this.ws.close();
  }
}

export class LocalConnection implements Connection {
  readonly kind = 'local';
  private readonly room: Room;
  private readonly id: string;
  private messageCb: ((msg: ServerMessage) => void) | null = null;
  private backlog: ServerMessage[] = [];

  constructor(name: string) {
    this.room = new Room('offline');
    this.room.start();
    this.id = this.room.join(name, { send: (m) => this.deliver(m) })!;
  }

  private deliver(msg: ServerMessage): void {
    if (this.messageCb) this.messageCb(msg);
    else this.backlog.push(msg);
  }

  send(msg: ClientMessage): void {
    this.room.receive(this.id, msg);
  }
  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCb = cb;
    for (const m of this.backlog.splice(0)) cb(m);
  }
  onClose(): void {}
  close(): void {
    this.room.leave(this.id);
    this.room.stop();
  }
}
