import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { hashPassword, verifyPassword, seedUser, getUser, requireAuth } from '../src/auth.js';

test('hash and verify round-trip', () => {
  const h = hashPassword('secret');
  assert.ok(verifyPassword('secret', h));
  assert.ok(!verifyPassword('wrong', h));
});

test('seedUser creates one user, replace updates it', () => {
  const db = openDb(':memory:');
  seedUser(db, 'abe', 'pw1');
  seedUser(db, 'abe', 'pw2');
  const count = db.prepare('SELECT COUNT(*) c FROM user').get().c;
  assert.equal(count, 1);
  assert.ok(verifyPassword('pw2', getUser(db, 'abe').password_hash));
});

test('requireAuth blocks anonymous, allows session', () => {
  const calls = [];
  const next = () => calls.push('next');
  const res = { redirect: (u) => calls.push('redirect:' + u), set() {}, status() { return res; }, end() {} };
  requireAuth({ session: {}, get: () => undefined }, res, next);
  requireAuth({ session: { userId: 1 }, get: () => undefined }, res, next);
  assert.deepEqual(calls, ['redirect:/login', 'next']);
});
