import { openDb } from '../src/db.js';
import { seedUser } from '../src/auth.js';

const username = process.env.TT_USERNAME;
const password = process.env.TT_PASSWORD;
if (!username || !password) {
  console.error('Set TT_USERNAME and TT_PASSWORD');
  process.exit(1);
}
const db = openDb(process.env.DB_PATH || 'data.sqlite');
seedUser(db, username, password);
console.log(`Seeded user ${username}`);
