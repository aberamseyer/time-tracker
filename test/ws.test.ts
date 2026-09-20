import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { createHub } from '../src/ws.js';

function fakeWs() {
  const sent: string[] = [];
  const handlers: Record<string, () => void> = {};
  return {
    readyState: 1, sent,
    send: (m: string) => sent.push(m),
    on: (e: string, f: () => void) => { handlers[e] = f; },
    fire: (e: string) => handlers[e] && handlers[e](),
  };
}

test('notify sends only to the user\'s clients', () => {
  const hub = createHub();
  const a = fakeWs(), b = fakeWs();
  hub.handleConnection(a as unknown as WebSocket, 1);
  hub.handleConnection(b as unknown as WebSocket, 2);
  hub.notify(1, 'changed');
  assert.deepEqual(a.sent, ['{"type":"changed"}']);
  assert.deepEqual(b.sent, []);
});

test('notify skips closed clients', () => {
  const hub = createHub();
  const a = fakeWs(), b = fakeWs();
  b.readyState = 3;
  hub.handleConnection(a as unknown as WebSocket, 1);
  hub.handleConnection(b as unknown as WebSocket, 1);
  hub.notify(1, 'changed');
  assert.deepEqual(a.sent, ['{"type":"changed"}']);
  assert.deepEqual(b.sent, []);
});

test('closed connection is removed', () => {
  const hub = createHub();
  const a = fakeWs();
  hub.handleConnection(a as unknown as WebSocket, 1);
  a.fire('close');
  hub.notify(1, 'changed');
  assert.deepEqual(a.sent, []);
});
