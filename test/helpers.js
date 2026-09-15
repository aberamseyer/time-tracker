import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedUser } from '../src/auth.js';

export function makeTestDb() {
  return openDb(':memory:');
}

export function makeApp(overrides = {}) {
  const db = overrides.db || makeTestDb();
  const hub = overrides.hub || { broadcast() {} };
  return { app: createApp({ db, hub }), db, hub };
}

export async function login(agent, db, username = 'abe', password = 'pw') {
  seedUser(db, username, password);
  await agent.post('/login').type('form').send({ username, password });
}
