import 'dotenv/config';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Request, Response } from 'express';
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

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  sessionMw(req as unknown as Request, {} as Response, () => {
    const session = (req as unknown as { session?: { userId?: number } }).session;
    if (!session || !session.userId) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => hub.handleConnection(ws));
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Time tracker on :${port}`));
