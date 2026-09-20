import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, pauseTimer, resumeTimer, stopTimer, getActiveSession, timerState } from '../src/timer.js';

const MIN = 60000;
const UID = 1;

test('start creates a running session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 1000, { tzMin: 0, userId: UID });
  const a = getActiveSession(db, UID)!;
  assert.equal(a.id, id);
  assert.equal(a.end_utc, null);
  assert.equal(timerState(db, 2000, UID).state, 'running');
});

test('starting again stops the previous active session', () => {
  const db = openDb(':memory:');
  const first = startTimer(db, 0, { tzMin: 0, userId: UID });
  startTimer(db, 5 * MIN, { tzMin: 0, userId: UID });
  assert.equal(getSession(db, first, UID)!.end_utc, 5 * MIN);
});

test('pause then resume accumulates paused_ms in same session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0, { tzMin: 0, userId: UID });
  pauseTimer(db, 10 * MIN, UID);
  assert.equal(timerState(db, 12 * MIN, UID).state, 'paused');
  resumeTimer(db, 20 * MIN, UID);
  const s = getSession(db, id, UID)!;
  assert.equal(s.paused_ms, 10 * MIN);
  assert.equal(s.pause_started_at, null);
});

test('stop while paused folds the open pause', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0, { tzMin: 0, userId: UID });
  pauseTimer(db, 10 * MIN, UID);
  stopTimer(db, 30 * MIN, 0, UID);
  const s = getSession(db, id, UID)!;
  assert.equal(s.end_utc, 30 * MIN);
  assert.equal(s.pause_started_at, null);
  assert.equal(s.paused_ms, 20 * MIN); // paused 10->30
});

test('pause/resume/stop with nothing active return null', () => {
  const db = openDb(':memory:');
  assert.equal(pauseTimer(db, 1, UID), null);
  assert.equal(resumeTimer(db, 1, UID), null);
  assert.equal(stopTimer(db, 1, 0, UID), null);
  assert.equal(timerState(db, 1, UID).state, 'none');
});