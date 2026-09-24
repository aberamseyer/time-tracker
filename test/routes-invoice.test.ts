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

test('invoice form prefills bill-to from client', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  db.prepare("INSERT INTO client (name, address, user_id) VALUES ('Acme', '123 St', ?)").run(UID);
  const clientId = (db.prepare('SELECT id FROM client WHERE user_id = ?').get(UID) as { id: number }).id;
  const res = await agent.get(`/partials/invoice-form?clientId=${clientId}`);
  assert.match(res.text, /name="billToName" type="text" value="Acme"/);
  assert.match(res.text, /name="billToAddress" rows="4">123 St</);
});

test('POST /invoice uses edited bill-to', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  db.prepare("INSERT INTO client (name, address, user_id) VALUES ('Acme', '123 St', ?)").run(UID);
  const clientId = (db.prepare('SELECT id FROM client WHERE user_id = ?').get(UID) as { id: number }).id;
  const res = await agent.post('/invoice').type('form').send({
    type: 'week', ps: String(Date.UTC(2026, 8, 14)), clientId: String(clientId),
    number: '1', date: '2026-09-22', billToName: 'Acme Corp', billToAddress: '9 Main Ave',
  });
  assert.match(res.text, /Acme Corp/);
  assert.match(res.text, /9 Main Ave/);
  assert.doesNotMatch(res.text, /123 St/);
  const stored = db.prepare('SELECT name, address FROM client WHERE id = ?').get(clientId) as { name: string; address: string };
  assert.deepEqual(stored, { name: 'Acme', address: '123 St' });
});

test('invoice form splits From default into name and address', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  db.prepare("UPDATE settings SET business_from = 'Me LLC\n1 Road' WHERE user_id = ?").run(UID);
  db.prepare("INSERT INTO client (name, address, user_id) VALUES ('Acme', '123 St', ?)").run(UID);
  const clientId = (db.prepare('SELECT id FROM client WHERE user_id = ?').get(UID) as { id: number }).id;
  const res = await agent.get(`/partials/invoice-form?clientId=${clientId}`);
  assert.match(res.text, /name="fromName" type="text" value="Me LLC"/);
  assert.match(res.text, /name="fromAddress" rows="4">1 Road</);
});

test('POST /invoice uses edited From', async () => {
  const { app, db } = makeApp();
  const agent = request.agent(app);
  await login(agent, db);
  db.prepare("UPDATE settings SET business_from = 'Me LLC\n1 Road' WHERE user_id = ?").run(UID);
  db.prepare("INSERT INTO client (name, address, user_id) VALUES ('Acme', '123 St', ?)").run(UID);
  const clientId = (db.prepare('SELECT id FROM client WHERE user_id = ?').get(UID) as { id: number }).id;
  const res = await agent.post('/invoice').type('form').send({
    type: 'week', ps: String(Date.UTC(2026, 8, 14)), clientId: String(clientId),
    number: '1', date: '2026-09-22', fromName: 'Other Co', fromAddress: '2 Lane',
  });
  assert.match(res.text, /<div class="name">Other Co<\/div>/);
  assert.match(res.text, /<div class="addr">2 Lane<\/div>/);
  assert.doesNotMatch(res.text, /Me LLC/);
});
