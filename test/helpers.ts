import type { Express } from 'express';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedUser } from '../src/auth.js';
import type { Hub } from '../src/types.js';

export function makeTestDb(): Database.Database {
  return openDb(':memory:');
}

export function makeApp(overrides: { db?: Database.Database; hub?: Partial<Hub> } = {}): {
  app: Express;
  db: Database.Database;
  hub: Hub;
} {
  const db = overrides.db ?? makeTestDb();
  const hub: Hub = { handleConnection() {}, notify() {}, ...overrides.hub };
  return { app: createApp({ db, hub }), db, hub };
}

export async function login(
  agent: import('supertest').Agent,
  db: Database.Database,
  username = 'abe',
  password = 'pw',
): Promise<void> {
  seedUser(db, username, password);
  await agent.post('/login').type('form').send({ username, password });
}
