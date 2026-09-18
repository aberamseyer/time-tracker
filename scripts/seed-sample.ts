import 'dotenv/config';
import { openDb } from '../src/db.js';
import { seedUser } from '../src/auth.js';
import { createClient, createTask, createTag, addTaskTag, updateTask } from '../src/catalog.js';
import { createSession, setSessionTags } from '../src/sessions.js';

// Generates ~a year of completed sessions for a test database.
// Guards data.sqlite; pass DB_PATH to target another file.
// Deterministic: set SEED to vary the dataset.

const DAY = 86400000;
const path = process.env.DB_PATH || 'data.sample.sqlite';
if (path === 'data.sqlite') {
  console.error('Refusing to seed data.sqlite; set DB_PATH to a test file');
  process.exit(1);
}

// Seeded RNG so runs are reproducible.
let state = (Number(process.env.SEED) || 1) >>> 0;
function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

const db = openDb(path);

// Fresh catalog/sessions; keep the settings row.
db.exec(`DELETE FROM session_tag; DELETE FROM task_tag; DELETE FROM session;
         DELETE FROM task; DELETE FROM tag; DELETE FROM client;`);

seedUser(db, process.env.TT_USERNAME || 'demo', process.env.TT_PASSWORD || 'demo');

const clients = [
  createClient(db, { name: 'Acme Co', defaultRateCents: 12000 }),
  createClient(db, { name: 'Globex', defaultRateCents: 9500 }),
];

const tags = {
  billable: createTag(db, { name: 'billable', color: '#16a34a' }),
  internal: createTag(db, { name: 'internal', color: '#6b7280' }),
  meeting: createTag(db, { name: 'meeting', color: '#f59e0b' }),
  bug: createTag(db, { name: 'bug', color: '#dc2626' }),
  research: createTag(db, { name: 'research', color: '#8b5cf6' }),
};

// [name, color, rateCents, clientId, defaultTagIds, descriptions]
const taskSpecs: [string, string, number | null, number | null, number[], string[]][] = [
  ['Feature work', '#3b82f6', 13000, clients[0], [tags.billable], ['Checkout flow', 'Dashboard widgets', 'Search filters']],
  ['Bug fixes', '#dc2626', 13000, clients[0], [tags.billable, tags.bug], ['Null crash on load', 'Timezone off-by-one', 'Race in uploader']],
  ['Client meetings', '#f59e0b', 15000, clients[1], [tags.billable, tags.meeting], ['Weekly sync', 'Scope review', 'Demo call']],
  ['Internal ops', '#6b7280', null, null, [tags.internal], ['Standup', 'Code review', 'Inbox']],
  ['Research', '#8b5cf6', null, null, [tags.internal, tags.research], ['Read RFCs', 'Prototype spike', 'Evaluate library']],
];

const tasks: { id: number; defTags: number[]; descs: string[] }[] = taskSpecs.map(
  ([name, color, rate, clientId, defTags, descs]) => {
    const id = createTask(db, { name, color, hourlyRateCents: rate, clientId });
    for (const t of defTags) addTaskTag(db, id, t);
    return { id, defTags, descs };
  }
);
updateTask(db, tasks[0].id, { name: 'Feature work', color: '#3b82f6', hourlyRateCents: 13000, isDefault: true });

const start = new Date();
start.setUTCHours(0, 0, 0, 0);
const startMs = start.getTime() - 365 * DAY;

const insert = db.transaction(() => {
  let count = 0;
  for (let day = 0; day < 365; day++) {
    const dayStart = startMs + day * DAY;
    const dow = new Date(dayStart).getUTCDay();
    if (dow === 0 || dow === 6) { if (rand() > 0.15) continue; } // rare weekend work
    const sessions = between(1, 4);
    let cursor = dayStart + 9 * 3600000 + between(0, 60) * 60000; // ~9am
    for (let i = 0; i < sessions; i++) {
      const task = pick(tasks);
      const durationMin = between(15, 180);
      const durationMs = durationMin * 60000;
      const pausedMs = rand() < 0.25 ? between(1, 20) * 60000 : 0;
      const startUtc = cursor;
      const endUtc = startUtc + durationMs + pausedMs;
      const id = createSession(db, {
        description: pick(task.descs),
        details: rand() < 0.3 ? 'Follow-up notes.' : '',
        taskId: task.id,
        startUtc, endUtc, pausedMs, createdAt: startUtc,
      });
      const extra = rand() < 0.2 ? [pick(Object.values(tags))] : [];
      setSessionTags(db, id, [...new Set([...task.defTags, ...extra])]);
      cursor = endUtc + between(5, 90) * 60000; // gap before next
      count++;
    }
  }
  return count;
});

const total = insert();
console.log(`Seeded ${path}: ${total} sessions across 365 days`);
