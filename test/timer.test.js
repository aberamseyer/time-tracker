import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { getSession } from '../src/sessions.js';
import { startTimer, pauseTimer, resumeTimer, stopTimer, getOpenSegment, timerState } from '../src/timer.js';

const MIN = 60000;

test('start creates running session with open segment', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 1000);
  const seg = getOpenSegment(db);
  assert.equal(seg.session_id, id);
  assert.equal(seg.end_utc, null);
  assert.ok(timerState(db, 2000).running);
});

test('starting again closes the previous open segment', () => {
  const db = openDb(':memory:');
  const first = startTimer(db, 0);
  startTimer(db, 5 * MIN);
  const firstSegs = getSession(db, first).segments;
  assert.equal(firstSegs[0].end_utc, 5 * MIN);
});

test('pause then resume creates a gap in same session', () => {
  const db = openDb(':memory:');
  const id = startTimer(db, 0);
  pauseTimer(db, 10 * MIN);
  assert.equal(getOpenSegment(db), undefined);
  resumeTimer(db, 20 * MIN, id);
  const segs = getSession(db, id).segments;
  assert.equal(segs.length, 2);
  assert.equal(segs[0].end_utc, 10 * MIN);
  assert.equal(segs[1].end_utc, null);
});

test('stop closes open segment', () => {
  const db = openDb(':memory:');
  startTimer(db, 0);
  const id = stopTimer(db, 30 * MIN);
  assert.equal(getOpenSegment(db), undefined);
  assert.equal(getSession(db, id).segments[0].end_utc, 30 * MIN);
});

test('pause/stop with nothing running returns null', () => {
  const db = openDb(':memory:');
  assert.equal(pauseTimer(db, 1), null);
  assert.equal(stopTimer(db, 1), null);
  assert.equal(timerState(db, 1).running, false);
});
