import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp } from './helpers.js';
import { seedUser } from '../src/auth.js';

test('login page renders', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/login');
  assert.equal(res.status, 200);
  assert.match(res.text, /name="password"/);
});

test('wrong password rejected, protected route redirects', async () => {
  const { app, db } = makeApp();
  seedUser(db, 'abe', 'pw');
  const bad = await request(app).post('/login').type('form').send({ username: 'abe', password: 'no' });
  assert.equal(bad.status, 200);
  assert.match(bad.text, /Invalid/);
  const prot = await request(app).get('/');
  assert.equal(prot.status, 302);
  assert.equal(prot.headers.location, '/login');
});

test('valid login reaches home', async () => {
  const { app, db } = makeApp();
  seedUser(db, 'abe', 'pw');
  const agent = request.agent(app);
  const ok = await agent.post('/login').type('form').send({ username: 'abe', password: 'pw' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.location, '/');
  const home = await agent.get('/');
  assert.equal(home.status, 200);
});
