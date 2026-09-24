import type { WebSocket } from 'ws';

export interface UserRow { id: number; username: string; password_hash: string; }

export interface ClientRow {
  id: number; name: string; address: string;
  default_rate_cents: number | null; currency: string; archived: number; user_id: number;
}

export interface TaskRow {
  id: number; name: string; details: string; color: string;
  hourly_rate_cents: number | null; client_id: number | null;
  is_default: number; archived: number; user_id: number;
}

export interface TagRow { id: number; name: string; color: string; archived: number; user_id: number; }

export interface ClientGroup { client: ClientRow | null; tasks: TaskRow[]; }

export interface SessionRow {
  id: number; description: string; details: string; task_id: number | null;
  created_at: number; start_utc: number | null; end_utc: number | null;
  paused_ms: number; pause_started_at: number | null;
  user_id: number;
}

export interface SettingsRow {
  user_id: number; business_from: string; currency: string; week_start: number;
  timezone: string; rounding_minutes: number; session_grouping: string; invoice_seq: number;
}

export interface HydratedSession extends SessionRow { tags: TagRow[]; task: TaskRow | null; }

export interface DecoratedSession extends HydratedSession {
  active: boolean; paused: boolean; running: boolean;
  durationMs: number; roundedMs: number; earningsCents: number;
  client?: ClientRow | null;
}

export interface SessionFilter {
  completedOnly?: boolean; q?: string; taskId?: number;
  unlabelled?: boolean; uncategorized?: boolean;
  clientId?: number | null; tagId?: number;
  taskIds?: number[]; tagIds?: number[];
  invertTask?: boolean; invertTag?: boolean;
  from?: number; to?: number;
}

export interface Bucket { start: number; label: string; }
export interface Series { key: string; name: string; color: string; values: number[]; total: number; }
export interface Report { buckets: Bucket[]; series: Series[]; grandTotal: number; metric: string; by: string; }
export interface Period { type: string; start: number; from: number; to: number; unit: 'day' | 'week'; label: string; }

export interface SessionGroup {
  key: string; anchor: number; label: string;
  sessions: DecoratedSession[]; totalMs: number; totalCents: number;
}

export interface Hub {
  handleConnection(ws: WebSocket, userId: number): void;
  notify(userId: number, type?: string): void;
}

export interface InvoiceLineItem {
  item: string; sub?: string;
  quantity: number; rateCents: number; amountCents: number;
}
export interface InvoiceParty { name: string; address: string; }
export interface Invoice {
  number: number; date: string; poNumber?: string; notes?: string;
  seller: InvoiceParty; client: ClientRow;
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  discountPct?: number; discountCents?: number;
  taxPct?: number; taxCents?: number;
  totalCents: number;
}
