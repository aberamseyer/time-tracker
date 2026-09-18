import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, stopTimer, getActiveSession } from '../src/timer.js';

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
