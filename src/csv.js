function q(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Decorated, completed sessions -> RFC-4180 CSV. Times are UTC, matching the app.
export function sessionsToCsv(rows) {
  const header = ['Date', 'Start', 'End', 'Description', 'Details', 'Client', 'Task', 'Tags', 'Duration (min)', 'Earnings'];
  const lines = [header.join(',')];
  for (const s of rows) {
    const start = new Date(s.start_utc).toISOString();
    const end = new Date(s.end_utc).toISOString();
    lines.push([
      start.slice(0, 10), start.slice(11, 16), end.slice(11, 16),
      s.description, s.details,
      s.client ? s.client.name : '',
      s.task ? s.task.name : '',
      s.tags.map(t => t.name).join('; '),
      Math.round(s.roundedMs / 60000),
      (s.earningsCents / 100).toFixed(2),
    ].map(q).join(','));
  }
  return lines.join('\n');
}
