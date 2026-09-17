import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsToCsv } from '../src/csv.js';

test('csv has header and formats rows', () => {
  const rows = [{
    start_utc: Date.UTC(2026, 0, 2, 9, 0), end_utc: Date.UTC(2026, 0, 2, 9, 30),
    description: 'Standup', details: 'daily', client: { name: 'Acme' }, task: { name: 'Dev' },
    tags: [{ name: 'urgent' }, { name: 'call' }], roundedMs: 1800000, earningsCents: 2500,
  }];
  const csv = sessionsToCsv(rows);
  const [header, line] = csv.split('\n');
  assert.equal(header, 'Date,Start,End,Description,Details,Client,Task,Tags,Duration (min),Earnings');
  assert.equal(line, '2026-01-02,09:00,09:30,Standup,daily,Acme,Dev,urgent; call,30,25.00');
});

test('csv quotes fields with commas and quotes', () => {
  const rows = [{
    start_utc: Date.UTC(2026, 0, 2), end_utc: Date.UTC(2026, 0, 2, 1),
    description: 'a, b', details: 'say "hi"', task: null, tags: [], roundedMs: 3600000, earningsCents: 0,
  }];
  const line = sessionsToCsv(rows).split('\n')[1];
  assert.ok(line.includes('"a, b"'));
  assert.ok(line.includes('"say ""hi"""'));
});
