export function roundUpDurationMs(ms, minutes) {
  if (!minutes) return ms;
  const interval = minutes * 60000;
  return Math.ceil(ms / interval) * interval;
}

export function sessionDurationMs(s, now) {
  const end = s.end_utc == null ? now : s.end_utc;
  const currentPause = s.pause_started_at == null ? 0 : now - s.pause_started_at;
  return (end - s.start_utc) - (s.paused_ms || 0) - currentPause;
}

export function earningsCents(durationMs, rateCents) {
  return Math.round((durationMs / 3600000) * rateCents);
}
