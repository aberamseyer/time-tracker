import type { WebSocket } from 'ws';
import type { Hub } from './types.js';

export function createHub(): Hub {
  const clients = new Map<number, Set<WebSocket>>();
  function handleConnection(ws: WebSocket, userId: number): void {
    let set = clients.get(userId);
    if (!set) { set = new Set<WebSocket>(); clients.set(userId, set); }
    set.add(ws);
    ws.on('close', () => {
      set!.delete(ws);
      if (set!.size === 0) clients.delete(userId);
    });
  }
  function notify(userId: number, type = 'changed'): void {
    const msg = JSON.stringify({ type });
    const set = clients.get(userId);
    if (!set) return;
    for (const ws of set) if (ws.readyState === 1) ws.send(msg);
  }
  return { handleConnection, notify };
}
