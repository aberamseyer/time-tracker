import { test } from 'node:test';
import assert from 'node:assert';
import { sessionLineItem, oneOffLineItem, computeTotals, buildInvoice } from '../src/invoice.js';
import { openDb } from '../src/db.js';
import { createClient, createTask, getClient } from '../src/catalog.js';
import { createSession } from '../src/sessions.js';
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

test('buildInvoice: one line item per completed session in range, excludes outside range', () => {
  const db = openDb(':memory:');
  const userId = 1;
  const clientId = createClient(db, { name: 'Acme' }, userId);
  const taskId = createTask(db, { name: 'Consulting', hourlyRateCents: 6000, clientId }, userId);

  const from = Date.UTC(2026, 8, 10);
  const to = Date.UTC(2026, 8, 16);

  // inside range: 1 hour and 2 hours
  createSession(db, {
    taskId, startUtc: Date.UTC(2026, 8, 12, 9), endUtc: Date.UTC(2026, 8, 12, 10), userId,
  });
  createSession(db, {
    taskId, startUtc: Date.UTC(2026, 8, 14, 9), endUtc: Date.UTC(2026, 8, 14, 11), userId,
  });
  // outside range: well before `from`
  createSession(db, {
    taskId, startUtc: Date.UTC(2026, 7, 1, 9), endUtc: Date.UTC(2026, 7, 1, 10), userId,
  });

  const client = getClient(db, clientId, userId)!;
  const invoice = buildInvoice(db, userId, {
    number: 1, date: '2026-09-22', seller: 'Me', client,
    from, to, clientId, rounding: 0,
  });

  assert.equal(invoice.lineItems.length, 2);
  for (const li of invoice.lineItems) {
    assert.equal(li.item, 'Consulting');
    assert.equal(li.rateCents, 6000);
  }
  const quantities = invoice.lineItems.map(li => li.quantity).sort((a, b) => a - b);
  assert.deepEqual(quantities, [1, 2]);
  const expectedSubtotal = invoice.lineItems.reduce((n, li) => n + li.amountCents, 0);
  assert.equal(invoice.subtotalCents, expectedSubtotal);
  assert.equal(invoice.subtotalCents, 6000 + 12000); // 1h + 2h @ $60/h
});
