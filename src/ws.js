export function createHub() {
  const clients = new Set();
  function handleConnection(ws) {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  }
  function broadcast(type = 'changed') {
    const msg = JSON.stringify({ type });
    for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
  }
  return { clients, handleConnection, broadcast };
}
