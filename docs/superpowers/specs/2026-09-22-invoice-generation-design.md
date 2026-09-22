# Invoice Generation — Design

Date: 2026-09-22

## Goal

Generate a printable invoice for one customer from the current stats-tab
view. Output is a standalone HTML page the user prints to PDF via the
browser. Layout mirrors `Estimate.html` (title INVOICE not ESTIMATE).

## Scope

- New biweekly period on the stats page and in settings grouping.
- One invoice line item per completed session in the current stats view.
- User-prompted fields: invoice number, date, PO number, notes, one-off
  line items (name/rate/quantity, may be negative), discount %, tax %.
- Blank fields are omitted from the rendered invoice.
- No billed/unbilled tracking.

## Non-goals

- Persisting invoices. Nothing stored except the invoice-number counter.
- Per-currency formatting: use existing `fmtMoney` (`$`) for consistency.
- Editing/emailing invoices. Print is the browser's job.

## Architecture

Two-layer, matching the codebase: pure data module + thin router + views.

- `src/invoice.ts` — all invoice math (session selection, line items, totals).
- `src/routes/invoice.ts` — parses request, requires a client, renders.
- `src/views/invoice.ejs` — standalone print page (no app nav).
- `src/views/partials/invoice-form.ejs` — modal form partial.

## Biweekly period

Both the stats-page navigation and the settings session grouping.

`src/analytics.ts`:
- `periodOf(type='biweek', ms, weekStart)`: anchor to a fixed epoch aligned
  to `week_start`. Reference = `weekStartOf(0, weekStart)`. Period start =
  `ref + floor((weekStartOf(ms, weekStart) - ref) / (14*MS_PER_DAY)) * 14*MS_PER_DAY`.
  `from = start`, `to = start + 13*MS_PER_DAY`, `unit = 'day'`.
  Label = `` `${mdLabel(start)} – ${mdLabel(to)}` `` (e.g. `Sep 16 – Sep 29`).
- `nextPeriodStart('biweek', start)` = `start + 14*MS_PER_DAY`.
- `listPeriods` needs no change; it uses `periodOf`/`nextPeriodStart`.

`src/routes/analytics.ts`: add `'biweek'` to `TYPES`.

`src/routes/analytics.ts` view (`partials/analytics-panel.ejs`): add a
`Biweek` option to the `type` segmented control.

`src/settings.ts`: add `'biweek'` to `GROUPING`.

`src/views/settings.ejs`: add `['biweek','Biweekly']` to `groupOpts`.

`routes/tracking.js` `bucketOf` already routes non-`day` units through
`periodOf`; biweekly works once `periodOf` knows it. Header label falls
through the `else` branch to `p.label` (the `Sep 16 – Sep 29` range).

## Session selection

Same filter as the chart. Reuse the range+filter logic already in
`routes/analytics.ts` `/export.csv`:

- `from/to` from `periodOf(type, ps, weekStart)`, expanded to
  `dayStartUTC(from) .. dayStartUTC(to) + MS_PER_DAY - 1`.
- `clientId`, `taskIds`, `tagIds` from the query.
- `listSessions(db, filter, userId)` then `.filter(s => s.end_utc != null)`,
  decorated with `decorateSession`, sorted by `start_utc` ascending.

## Line items

Per session (one line each, no collapsing):
- `item` = `task.name` if present, else `description`.
- `sub` = `` `${dayLabel(start_utc)} · ${description}` `` (description omitted
  if empty). Rendered smaller beneath `item`.
- `quantityHours` = `roundedMs / MS_PER_HOUR`, 2-decimal display.
- `rateCents` = `effectiveRateCents(db, task_id, userId)`.
- `amountCents` = `earningsCents`.

One-off items (appended after session lines):
- `{ name, rateCents, quantity }`; `amountCents = round(rateCents * quantity)`.
- `quantity` and `rateCents` may be negative (discount lines).
- `sub` absent.

## Totals

- `subtotalCents` = sum of all line `amountCents` (session + one-off).
- `discountCents = Math.round(subtotalCents * discountPct / 100)`.
- `taxCents = Math.round(subtotalCents * taxPct / 100)`.
- Both computed off the raw subtotal (per requirement), not the discounted
  amount.
- `totalCents = subtotalCents - discountCents + taxCents`.
- Discount / tax rows omitted when their percent is blank or 0.

## Invoice number (auto-increment)

- Add column `invoice_seq INTEGER NOT NULL DEFAULT 0` to `settings`:
  - `src/db.ts` SCHEMA `CREATE TABLE settings` (fresh DBs).
  - `src/db.ts` `migrate()`: call `addColumn(db, 'settings', 'invoice_seq',
    'INTEGER NOT NULL DEFAULT 0')` (existing DBs). `migrate()` currently calls
    no `addColumn`; this is the first.
- `src/settings.ts`:
  - `nextInvoiceNumber(db, userId)` → `invoice_seq + 1`.
  - `recordInvoiceNumber(db, userId, n)` → set `invoice_seq = max(invoice_seq, n)`.
- `SettingsRow` gains `invoice_seq: number` in `types.ts` and the
  `getSettings` fallback default (`invoice_seq: 0`).

## Router — `src/routes/invoice.ts`

`invoiceRouter(db, hub): Router` mounted in `app.js` behind `requireAuth`.

- `GET /partials/invoice-form` — reads the stats view query. If no single
  `clientId`, renders a short message ("Select a client to invoice").
  Otherwise renders `partials/invoice-form` with: prefilled invoice number
  (`nextInvoiceNumber`), today's date, the client, and hidden fields carrying
  `type`, `ps`, `clientId`, `taskId[]`, `tagId[]`.
- `POST /invoice` (form target `_blank`, standard nav) — builds the invoice
  via `invoice.ts`, calls `recordInvoiceNumber`, renders `invoice.ejs` full
  page. GET side effects avoided by using POST.

Handlers typed `(req: Request, res: Response)`; SQL/logic stays in modules.

## Views

`partials/invoice-form.ejs` (modal body):
- Fields: invoice number, date, PO number, notes (textarea), discount %,
  tax %, and repeatable one-off rows (name / rate / qty) with an "add row"
  control (vanilla JS clone).
- Hidden fields preserve the stats view filter.
- `<form method="post" action="/invoice" target="_blank">`; a close button.

`invoice.ejs` (standalone):
- No app nav. Reuse `app.css` plus a scoped `.invoice` block and
  `@media print` rules (hide the Print button on print).
- Sections mirror the sample: seller block (`settings.business_from`),
  `INVOICE` + number, Bill To (`client.name` / `client.address`),
  Date / PO column, line-item table (Item / Quantity / Rate / Amount),
  subtotal, discount, tax, total, Notes.
- Every optional field wrapped so blanks render nothing.

Stats page: a "Generate invoice" button in `analytics-panel.ejs`,
`hx-get="/partials/invoice-form?<current view qs>"` targeting a `<dialog>`
container; opened via a small handler in `public/app.js` (`showModal`).
Button disabled unless a single client is selected.

## Types (`src/types.ts`)

```ts
export interface InvoiceLineItem {
  item: string; sub?: string;
  quantity: number; rateCents: number; amountCents: number;
}
export interface Invoice {
  number: number; date: string; poNumber?: string; notes?: string;
  seller: string; client: ClientRow;
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  discountPct?: number; discountCents?: number;
  taxPct?: number; taxCents?: number;
  totalCents: number;
}
```
`SettingsRow` gains `invoice_seq: number`.

## Testing

- `test/invoice.test.ts`: subtotal sums session + one-off lines; discount and
  tax both computed off subtotal; negative one-off reduces subtotal; blank
  discount/tax produce no rows; quantity = rounded hours.
- `test/analytics.test.ts`: biweekly `periodOf` boundaries (14-day, anchored,
  stable), `nextPeriodStart`, label.
- `test/settings.test.ts`: `biweek` accepted by `updateSettings`;
  `nextInvoiceNumber`/`recordInvoiceNumber` behavior.
- Route test: `/partials/invoice-form` requires a client; `POST /invoice`
  renders the invoice and bumps `invoice_seq`.

## Migration checklist (AGENTS.md hygiene)

- `invoice_seq` added to both `CREATE TABLE` and `migrate()` `addColumn`.
- `types.ts` `SettingsRow` updated with `invoice_seq`.
- `getSettings` fallback default updated.
