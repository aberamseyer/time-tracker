import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createHub } from './ws.js';
import { buildSessionMiddleware } from './auth.js';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

const db = openDb(process.env.DB_PATH || 'data.sqlite');
const hub = createHub();
const app = createApp({ db, hub });
const server = http.createServer(app);

const sessionMw = buildSessionMiddleware(db);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  sessionMw(req, {}, () => {
    if (!req.session || !req.session.userId) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws));
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Time tracker on :${port}`));
