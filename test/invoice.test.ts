import { test } from 'node:test';
import assert from 'node:assert';
import { sessionLineItem, oneOffLineItem, computeTotals } from '../src/invoice.js';
import type { DecoratedSession } from '../src/types.js';

const HOUR = 3600000;

function fakeSession(over: Partial<DecoratedSession>): DecoratedSession {
  return {
    id: 1, description: '', details: '', task_id: null, created_at: 0,
    start_utc: Date.UTC(2026, 8, 16), end_utc: Date.UTC(2026, 8, 16) + HOUR,
    paused_ms: 0, pause_started_at: null, user_id: 1, tags: [], task: null,
    active: false, paused: false, running: false,
    durationMs: HOUR, roundedMs: HOUR, earningsCents: 6400, ...over,
  } as DecoratedSession;
}

test('session line item uses task name, hours, rate, amount', () => {
  const s = fakeSession({ description: 'batch run', roundedMs: 2 * HOUR, earningsCents: 12800,
    task: { id: 3, name: 'Pipeline', details: '', color: '#000', hourly_rate_cents: 6400, client_id: 1, is_default: 0, archived: 0, user_id: 1 } });
  const li = sessionLineItem(s, 6400);
  assert.equal(li.item, 'Pipeline');
  assert.match(li.sub!, /Sep 16, 2026/);
  assert.match(li.sub!, /batch run/);
  assert.equal(li.quantity, 2);
  assert.equal(li.rateCents, 6400);
  assert.equal(li.amountCents, 12800);
});

test('one-off can be negative', () => {
  const li = oneOffLineItem({ name: 'Discount', rateCents: -5000, quantity: 1 });
  assert.equal(li.amountCents, -5000);
  assert.equal(li.sub, undefined);
});

test('totals compute discount and tax off subtotal', () => {
  const items = [
    { item: 'a', quantity: 1, rateCents: 10000, amountCents: 10000 },
    { item: 'b', quantity: 1, rateCents: -2000, amountCents: -2000 },
  ];
  const t = computeTotals(items, 10, 5);
  assert.equal(t.subtotalCents, 8000);
  assert.equal(t.discountCents, 800); // 10% of 8000
  assert.equal(t.taxCents, 400);      // 5% of 8000 (off subtotal, not discounted)
  assert.equal(t.totalCents, 7600);   // 8000 - 800 + 400
});

test('blank discount and tax produce no rows', () => {
  const t = computeTotals([{ item: 'a', quantity: 1, rateCents: 8000, amountCents: 8000 }]);
  assert.equal(t.discountCents, undefined);
  assert.equal(t.taxCents, undefined);
  assert.equal(t.totalCents, 8000);
});
