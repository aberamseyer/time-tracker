import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, stopTimer, getActiveSession, splitExpiredDays } from '../src/timer.js';

const HOUR = 3600000;
const CDT = 300; // UTC-5 offset in minutes (Date.getTimezoneOffset style)

test('stop freezes real start/end to civil, preserving duration', () => {
  const db = openDb(':memory:');
  const realStart = 20 * HOUR;            // 20:00 UTC real instant
  const id = startTimer(db, realStart);
  stopTimer(db, realStart + HOUR, CDT);   // one real hour later, tz UTC-5
  const s = getSession(db, id)!;
  const off = CDT * 60000;
  assert.equal(s.start_utc, realStart - off);            // civil 15:00
  assert.equal(s.end_utc, realStart + HOUR - off);       // civil 16:00
  assert.equal(s.end_utc! - s.start_utc! - s.paused_ms, HOUR); // duration intact
});

test('starting a new timer freezes the prior running session with tz', () => {
  const db = openDb(':memory:');
  const realStart = 20 * HOUR;
  const first = startTimer(db, realStart);
  startTimer(db, realStart + HOUR, { tzMin: CDT });      // stops `first`
  const s = getSession(db, first)!;
  const off = CDT * 60000;
  assert.equal(s.end_utc, realStart + HOUR - off);
  assert.equal(getActiveSession(db)!.start_utc, realStart + HOUR); // new one still real
});

const DAY = 86400000;

test('split closes the day at civil midnight and opens next day running', () => {
  const db = openDb(':memory:');
  const off = CDT * 60000;
  const civilStart = 23 * HOUR;            // civil 23:00 on day 0
  const realStart = civilStart + off;
  const first = startTimer(db, realStart);
  const nowReal = (24 * HOUR + 30 * 60000) + off;  // civil 00:30 next day
  const changed = splitExpiredDays(db, nowReal, CDT);
  assert.equal(changed, true);
  const closed = getSession(db, first)!;
  assert.equal(closed.start_utc, civilStart);            // frozen civil 23:00
  assert.equal(closed.end_utc, DAY - 1);                 // civil 23:59:59.999 day 0
  const active = getActiveSession(db)!;
  assert.equal(active.start_utc, DAY + off);             // real instant of next local midnight
  assert.equal(active.end_utc, null);
});

test('split loops across multiple days', () => {
  const db = openDb(':memory:');
  const off = CDT * 60000;
  startTimer(db, 0 + off);                               // civil 00:00 day 0
  const nowReal = (2 * DAY + HOUR) + off;                // civil day 2, 01:00
  splitExpiredDays(db, nowReal, CDT);
  const active = getActiveSession(db)!;
  assert.equal(active.start_utc, 2 * DAY + off);         // day 2 midnight (real)
  assert.equal(active.end_utc, null);
});
