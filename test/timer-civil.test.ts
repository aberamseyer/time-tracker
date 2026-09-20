import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, stopTimer, pauseTimer, getActiveSession, splitExpiredDays } from '../src/timer.js';

const HOUR = 3600000;
const CDT = 300; // UTC-5 offset in minutes (Date.getTimezoneOffset style)
const UID = 1;

test('stop freezes real start/end to civil, preserving duration', () => {
  const db = openDb(':memory:');
  const realStart = 20 * HOUR;            // 20:00 UTC real instant
  const id = startTimer(db, realStart, { tzMin: 0, userId: UID });
  stopTimer(db, realStart + HOUR, CDT, UID);
  const s = getSession(db, id, UID)!;
  const off = CDT * 60000;
  assert.equal(s.start_utc, realStart - off);            // civil 15:00
  assert.equal(s.end_utc, realStart + HOUR - off);       // civil 16:00
  assert.equal(s.end_utc! - s.start_utc! - s.paused_ms, HOUR); // duration intact
});

test('starting a new timer freezes the prior running session with tz', () => {
  const db = openDb(':memory:');
  const realStart = 20 * HOUR;
  const first = startTimer(db, realStart, { tzMin: 0, userId: UID });
  startTimer(db, realStart + HOUR, { tzMin: CDT, userId: UID });      // stops `first`
  const s = getSession(db, first, UID)!;
  const off = CDT * 60000;
  assert.equal(s.end_utc, realStart + HOUR - off);
  assert.equal(getActiveSession(db, UID)!.start_utc, realStart + HOUR); // new one still real
});

const DAY = 86400000;

test('split closes the day at civil midnight and opens next day running', () => {
  const db = openDb(':memory:');
  const off = CDT * 60000;
  const civilStart = 23 * HOUR;            // civil 23:00 on day 0
  const realStart = civilStart + off;
  const first = startTimer(db, realStart, { tzMin: 0, userId: UID });
  const nowReal = (24 * HOUR + 30 * 60000) + off;  // civil 00:30 next day
  const changed = splitExpiredDays(db, nowReal, CDT, UID);
  assert.equal(changed, true);
  const closed = getSession(db, first, UID)!;
  assert.equal(closed.start_utc, civilStart);            // frozen civil 23:00
  assert.equal(closed.end_utc, DAY - 1);                 // civil 23:59:59.999 day 0
  const active = getActiveSession(db, UID)!;
  assert.equal(active.start_utc, DAY + off);             // real instant of next local midnight
  assert.equal(active.end_utc, null);
});

test('split loops across multiple days', () => {
  const db = openDb(':memory:');
  const off = CDT * 60000;
  startTimer(db, 0 + off, { tzMin: 0, userId: UID });                               // civil 00:00 day 0
  const nowReal = (2 * DAY + HOUR) + off;                // civil day 2, 01:00
  splitExpiredDays(db, nowReal, CDT, UID);
  const active = getActiveSession(db, UID)!;
  assert.equal(active.start_utc, 2 * DAY + off);         // day 2 midnight (real)
  assert.equal(active.end_utc, null);
});

test('split preserves pause across midnight', () => {
  const db = openDb(':memory:');
  const off = CDT * 60000;
  const civilStart = 23 * HOUR;                  // civil 23:00 day 0
  const realStart = civilStart + off;
  const first = startTimer(db, realStart, { tzMin: 0, userId: UID });
  pauseTimer(db, realStart + 30 * 60000, UID);        // pause at civil 23:30 (real)
  const nowReal = (24 * HOUR + 30 * 60000) + off; // civil 00:30 next day
  splitExpiredDays(db, nowReal, CDT, UID);
  const closed = getSession(db, first, UID)!;
  assert.equal(closed.end_utc, DAY - 1);         // civil 23:59:59.999 day 0
  assert.equal(closed.pause_started_at, null);   // pause folded on close
  const active = getActiveSession(db, UID)!;
  assert.equal(active.start_utc, DAY + off);      // real next-midnight
  assert.equal(active.pause_started_at, DAY + off); // still paused from boundary
});