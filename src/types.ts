import type { WebSocket } from 'ws';

export interface UserRow { id: number; username: string; password_hash: string; }

export interface ClientRow {
  id: number; name: string; address: string;
  default_rate_cents: number | null; currency: string; archived: number;
}

export interface TaskRow {
  id: number; name: string; details: string; color: string;
  hourly_rate_cents: number | null; client_id: number | null;
  is_default: number; archived: number;
}

export interface TagRow { id: number; name: string; color: string; archived: number; }

export interface SessionRow {
  id: number; description: string; details: string; task_id: number | null;
  created_at: number; start_utc: number | null; end_utc: number | null;
  paused_ms: number; pause_started_at: number | null;
}

export interface SettingsRow {
  id: number; business_from: string; currency: string; week_start: number;
  timezone: string; rounding_minutes: number; session_grouping: string;
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

export interface Hub {
  clients: Set<WebSocket>;
  handleConnection(ws: WebSocket): void;
  broadcast(type?: string): void;
}
