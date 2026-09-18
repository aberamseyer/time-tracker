import type Database from 'better-sqlite3';

// Categorical palettes auto-assigned to new tasks and tags for distinct colors.
// Hues are the dataviz reference set, validated for adjacent CVD separation in
// light and dark. Tags reuse the same hues in a rotated order so a fresh task
// and tag don't land on the same color.
export const TASK_COLORS: string[] = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
];
export const TAG_COLORS: string[] = [
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
];

// Least-used palette color for the kind; ties keep palette order.
export function suggestColor(db: Database.Database, kind: 'task' | 'tag'): string {
  const palette = kind === 'tag' ? TAG_COLORS : TASK_COLORS;
  const table = kind === 'tag' ? 'tag' : 'task';
  const counts = new Map<string, number>(palette.map(c => [c, 0]));
  const rows = db.prepare(`SELECT color FROM ${table}`).all() as { color: string }[];
  for (const { color } of rows) {
    if (counts.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best = palette[0], min = Infinity;
  for (const c of palette) {
    const n = counts.get(c) ?? 0;
    if (n < min) { min = n; best = c; }
  }
  return best;
}
