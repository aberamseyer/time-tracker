import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, pauseTimer, resumeTimer, stopTimer, getActiveSession, timerState } from '../src/timer.js';

const MIN = 60000;

test('start creates a running session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 1000);
  const a = getActiveSession(db)!;
  assert.equal(a.id, id);
  assert.equal(a.end_utc, null);
  assert.equal(timerState(db, 2000).state, 'running');
});

test('starting again stops the previous active session', () => {
  const db = openDb(':memory:');
  const first = startTimer(db, 0);
  startTimer(db, 5 * MIN);
  assert.equal(getSession(db, first)!.end_utc, 5 * MIN);
});

test('pause then resume accumulates paused_ms in same session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  assert.equal(timerState(db, 12 * MIN).state, 'paused');
  assert.equal(timerState(db, 12 * MIN).elapsedMs, 10 * MIN); // frozen
  resumeTimer(db, 20 * MIN);
  const s = getSession(db, id)!;
  assert.equal(s.paused_ms, 10 * MIN);
  assert.equal(s.pause_started_at, null);
  assert.equal(timerState(db, 25 * MIN).elapsedMs, 15 * MIN); // 25 - 10 paused
});

test('stop while paused folds the open pause', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  stopTimer(db, 30 * MIN);
  const s = getSession(db, id)!;
  assert.equal(s.end_utc, 30 * MIN);
  assert.equal(s.pause_started_at, null);
  assert.equal(s.paused_ms, 20 * MIN); // paused 10->30
});

test('pause/resume/stop with nothing active return null', () => {
  const db = openDb(':memory:');
  assert.equal(pauseTimer(db, 1), null);
  assert.equal(resumeTimer(db, 1), null);
  assert.equal(stopTimer(db, 1), null);
  assert.equal(timerState(db, 1).state, 'none');
});
