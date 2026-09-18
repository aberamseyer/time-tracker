import type { SessionRow } from './types.js';

export function roundUpDurationMs(ms: number, minutes: number): number {
  if (!minutes) return ms;
  const interval = minutes * 60000;
  return Math.ceil(ms / interval) * interval;
}

export function sessionDurationMs(
  s: Pick<SessionRow, 'start_utc' | 'end_utc' | 'paused_ms' | 'pause_started_at'>,
  now: number,
): number {
  const end = s.end_utc == null ? now : s.end_utc;
  const start = s.start_utc ?? 0;
  const currentPause = s.pause_started_at == null ? 0 : now - s.pause_started_at;
  return (end - start) - (s.paused_ms || 0) - currentPause;
}

export function earningsCents(durationMs: number, rateCents: number): number {
  return Math.round((durationMs / 3600000) * rateCents);
}
