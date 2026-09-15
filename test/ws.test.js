import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/ws.js';

function fakeWs() {
  const sent = [];
  const handlers = {};
  return {
    readyState: 1, sent,
    send: (m) => sent.push(m),
    on: (e, f) => { handlers[e] = f; },
    fire: (e) => handlers[e] && handlers[e](),
  };
}

test('broadcast reaches open clients only', () => {
  const hub = createHub();
  const a = fakeWs(), b = fakeWs();
  b.readyState = 3;
  hub.handleConnection(a);
  hub.handleConnection(b);
  hub.broadcast('changed');
  assert.deepEqual(a.sent, ['{"type":"changed"}']);
  assert.deepEqual(b.sent, []);
});

test('closed client is removed', () => {
  const hub = createHub();
  const a = fakeWs();
  hub.handleConnection(a);
  a.fire('close');
  hub.broadcast('changed');
  assert.deepEqual(a.sent, []);
});
