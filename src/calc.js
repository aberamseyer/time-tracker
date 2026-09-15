export function roundDurationMs(ms, roundingMinutes) {
  if (!roundingMinutes) return ms;
  const interval = roundingMinutes * 60000;
  return Math.round(ms / interval) * interval;
}

export function segmentsDurationMs(segments, now) {
  let total = 0;
  for (const s of segments) {
    const end = s.end_utc == null ? now : s.end_utc;
    total += end - s.start_utc;
  }
  return total;
}

export function earningsCents(durationMs, rateCents) {
  return Math.round((durationMs / 3600000) * rateCents);
}
