import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

export function makeTestDb() {
  return openDb(':memory:');
}

export function makeApp(overrides = {}) {
  const db = overrides.db || makeTestDb();
  const hub = overrides.hub || { broadcast() {} };
  return { app: createApp({ db, hub }), db, hub };
}
