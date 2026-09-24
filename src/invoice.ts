import type Database from 'better-sqlite3';
import { listSessions, decorateSession } from './sessions.js';
import { effectiveRateCents } from './catalog.js';
import { dayStartUTC } from './analytics.js';
import { MS_PER_HOUR, MS_PER_DAY } from './constants.js';
import type { DecoratedSession, InvoiceLineItem, Invoice, InvoiceParty, ClientRow, SessionFilter } from './types.js';

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

// First line is the name; remaining lines are the address.
export function splitParty(text: string): InvoiceParty {
  const [name = '', ...rest] = text.split(/\r?\n/);
  return { name: name.trim(), address: rest.join('\n').trim() };
}

export function sessionLineItem(s: DecoratedSession, rateCents: number): InvoiceLineItem {
  const start = s.start_utc ?? s.created_at;
  const date = dateLabel(start);
  const item = s.task ? s.task.name : (s.description || 'Session');
  const sub = s.description ? `${date} · ${s.description}` : date;
  return { item, sub, quantity: s.roundedMs / MS_PER_HOUR, rateCents, amountCents: s.earningsCents };
}

export function oneOffLineItem(o: { name: string; rateCents: number; quantity: number }): InvoiceLineItem {
  return { item: o.name, quantity: o.quantity, rateCents: o.rateCents, amountCents: Math.round(o.rateCents * o.quantity) };
}

export function computeTotals(items: InvoiceLineItem[], discountPct?: number, taxPct?: number) {
  const subtotalCents = items.reduce((n, i) => n + i.amountCents, 0);
  const out: {
    subtotalCents: number; discountPct?: number; discountCents?: number;
    taxPct?: number; taxCents?: number; totalCents: number;
  } = { subtotalCents, totalCents: subtotalCents };
  if (discountPct) {
    out.discountPct = discountPct;
    out.discountCents = Math.round(subtotalCents * discountPct / 100);
    out.totalCents -= out.discountCents;
  }
  if (taxPct) {
    out.taxPct = taxPct;
    out.taxCents = Math.round(subtotalCents * taxPct / 100);
    out.totalCents += out.taxCents;
  }
  return out;
}

export function selectInvoiceSessions(
  db: Database.Database, userId: number,
  opts: { from: number; to: number; clientId: number; taskIds?: number[]; tagIds?: number[]; rounding: number },
): DecoratedSession[] {
  const filter: SessionFilter = {
    from: dayStartUTC(opts.from), to: dayStartUTC(opts.to) + MS_PER_DAY - 1, clientId: opts.clientId,
  };
  if (opts.taskIds && opts.taskIds.length) filter.taskIds = opts.taskIds;
  if (opts.tagIds && opts.tagIds.length) filter.tagIds = opts.tagIds;
  return listSessions(db, filter, userId)
    .filter(s => s.end_utc != null)
    .sort((a, b) => (a.start_utc ?? 0) - (b.start_utc ?? 0))
    .map(s => decorateSession(db, s, Date.now(), opts.rounding, userId));
}

export function buildInvoice(
  db: Database.Database, userId: number,
  opts: {
    number: number; date: string; poNumber?: string; notes?: string;
    seller: InvoiceParty; client: ClientRow;
    from: number; to: number; clientId: number; taskIds?: number[]; tagIds?: number[];
    rounding: number;
    oneOffs?: { name: string; rateCents: number; quantity: number }[];
    discountPct?: number; taxPct?: number;
  },
): Invoice {
  const sessions = selectInvoiceSessions(db, userId, opts);
  const lineItems: InvoiceLineItem[] = sessions.map(s => sessionLineItem(s, effectiveRateCents(db, s.task_id, userId)));
  for (const o of opts.oneOffs ?? []) lineItems.push(oneOffLineItem(o));
  const totals = computeTotals(lineItems, opts.discountPct, opts.taxPct);
  return {
    number: opts.number, date: opts.date, poNumber: opts.poNumber, notes: opts.notes,
    seller: opts.seller, client: opts.client, lineItems, ...totals,
  };
}
