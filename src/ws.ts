import type { WebSocket } from 'ws';
import type { Hub } from './types.js';

export function createHub(): Hub {
  const clients = new Set<WebSocket>();
  function handleConnection(ws: WebSocket): void {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  }
  function broadcast(type = 'changed'): void {
    const msg = JSON.stringify({ type });
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  }
  return { clients, handleConnection, broadcast };
}
