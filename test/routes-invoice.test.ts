import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, login } from './helpers.js';

const UID = 1;

test('invoice form requires a client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  const res = await agent.get('/partials/invoice-form');
  assert.match(res.text, /Select a client/i);
});

test('POST /invoice renders invoice and bumps counter', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  // seed a client so bill-to resolves
  db.prepare("INSERT INTO client (name, address, user_id) VALUES ('Acme', '123 St', ?)").run(UID);
  const clientId = (db.prepare('SELECT id FROM client WHERE user_id = ?').get(UID) as { id: number }).id;
  const res = await agent.post('/invoice').type('form').send({
    type: 'week', ps: String(Date.UTC(2026, 8, 14)), clientId: String(clientId),
    number: '1', date: '2026-09-22', discountPct: '', taxPct: '',
  });
  assert.match(res.text, /INVOICE/);
  assert.match(res.text, /Acme/);
  const seq = (db.prepare('SELECT invoice_seq FROM settings WHERE user_id = ?').get(UID) as { invoice_seq: number }).invoice_seq;
  assert.equal(seq, 1);
});
