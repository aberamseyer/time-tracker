import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { buildInvoice, splitParty } from '../invoice.js';
import { getSettings, nextInvoiceNumber, recordInvoiceNumber } from '../settings.js';
import { getClient } from '../catalog.js';
import { periodOf } from '../analytics.js';
import { fmtMoney, escapeHtml } from './tracking.js';
import type { Hub } from '../types.js';

const TYPES = ['week', 'biweek', 'month', 'quarter'];

function uid(req: Request): number { return (req.session && req.session.userId) ? req.session.userId : 0; }
function idsFrom(v: unknown): number[] {
  return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map(Number).filter(n => !Number.isNaN(n));
}
function num(v: unknown): number | undefined { const n = Number(v); return v === '' || v == null || Number.isNaN(n) ? undefined : n; }

export function invoiceRouter(db: Database.Database, _hub: Hub): Router {
  const r = express.Router();

  r.get('/partials/invoice-form', (req: Request, res: Response) => {
    const userId = uid(req);
    const q = req.query as Record<string, unknown>;
    const clientId = q.clientId ? Number(q.clientId) : 0;
    const client = clientId ? getClient(db, clientId, userId) : undefined;
    if (!client) { res.render('partials/invoice-form', { client: null }); return; }
    res.render('partials/invoice-form', {
      client,
      number: nextInvoiceNumber(db, userId),
      today: new Date().toISOString().slice(0, 10),
      from: splitParty(getSettings(db, userId).business_from),
      escapeHtml,
      view: { type: (q.type as string) || 'week', ps: q.ps ? Number(q.ps) : Date.now(),
        clientId, taskIds: idsFrom(q.taskId), tagIds: idsFrom(q.tagId) },
    });
  });

  r.post('/invoice', (req: Request, res: Response) => {
    const userId = uid(req);
    const b = req.body as Record<string, unknown>;
    const clientId = Number(b.clientId);
    const client = getClient(db, clientId, userId);
    if (!client) { res.status(400).send('Client required'); return; }
    const settings = getSettings(db, userId);
    const type = TYPES.includes(b.type as string) ? (b.type as string) : 'week';
    const period = periodOf(type, b.ps ? Number(b.ps) : Date.now(), settings.week_start ?? 1);

    // One-off rows arrive as parallel arrays name[]/rate[]/qty[].
    const names = Array.isArray(b.ooName) ? b.ooName : b.ooName ? [b.ooName] : [];
    const rates = Array.isArray(b.ooRate) ? b.ooRate : b.ooRate ? [b.ooRate] : [];
    const qtys = Array.isArray(b.ooQty) ? b.ooQty : b.ooQty ? [b.ooQty] : [];
    const oneOffs = (names as unknown[]).map((n, i) => ({
      name: String(n),
      rateCents: Math.round(Number((rates as unknown[])[i]) * 100) || 0,
      quantity: Number((qtys as unknown[])[i]) || 0,
    })).filter(o => o.name && (o.rateCents || o.quantity));

    const defaultFrom = splitParty(settings.business_from);
    const number = Number(b.number) || nextInvoiceNumber(db, userId);
    const invoice = buildInvoice(db, userId, {
      number, date: String(b.date || new Date().toISOString().slice(0, 10)),
      poNumber: (b.poNumber as string) || undefined, notes: (b.notes as string) || undefined,
      seller: {
        name: (b.fromName as string) || defaultFrom.name,
        address: typeof b.fromAddress === 'string' ? b.fromAddress : defaultFrom.address,
      },
      client: {
        ...client,
        name: (b.billToName as string) || client.name,
        address: typeof b.billToAddress === 'string' ? b.billToAddress : client.address,
      },
      from: period.from, to: period.to, clientId, taskIds: idsFrom(b.taskId), tagIds: idsFrom(b.tagId),
      rounding: settings.rounding_minutes,
      oneOffs, discountPct: num(b.discountPct), taxPct: num(b.taxPct),
    });
    recordInvoiceNumber(db, userId, number);
    res.render('invoice', { invoice, fmtMoney, escapeHtml });
  });

  return r;
}
