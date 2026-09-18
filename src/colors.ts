import type Database from 'better-sqlite3';

// Categorical palettes auto-assigned to new tasks and tags for distinct colors.
// Hues are the dataviz reference set, validated for adjacent CVD separation in
// light and dark. Tags reuse the same hues in a rotated order so a fresh task
// and tag don't land on the same color.
export const TASK_COLORS: string[] = [
	'#A64B2A', // Burnt Terracotta
	'#C67D33', // Spiced Amber
	'#4E5D4E', // Mossy Pine
	'#886A4A', // Stormy Ochre
	'#4A5568', // Twilight Slate
	'#6B4452', // Plum Bark
	'#2D6A75', // Deep Spruce
	'#4B3A33'  // Earthy Cocoa
];
export const TAG_COLORS: string[] = [
	'#E7DFD4', // Parchment
	'#BFCDB8', // Aged Sage
	'#DCC5AE', // Warmed Taupe
	'#DECB8B', // Ochre Wheat
	'#CAB8D6', // Dusty Mauve
	'#AEBECF', // Stormy Slate
	'#EEDBB2', // Antique Apricot
	'#C8D7BE', // Washed Mint
];

// First palette color, used as the column/route default for each kind.
export const DEFAULT_TASK_COLOR: string = TASK_COLORS[0];
export const DEFAULT_TAG_COLOR: string = TAG_COLORS[0];

// Least-used palette color for the kind; ties keep palette order.
export function suggestColor(db: Database.Database, kind: 'task' | 'tag'): string {
  const palette = kind === 'tag' ? TAG_COLORS : TASK_COLORS;
  const table = kind === 'tag' ? 'tag' : 'task';
  // Compare case-insensitively: <input type=color> submits lowercase hex.
  const counts = new Map<string, number>(palette.map(c => [c.toLowerCase(), 0]));
  const rows = db.prepare(`SELECT color FROM ${table}`).all() as { color: string }[];
  for (const { color } of rows) {
    const key = color.toLowerCase();
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = palette[0], min = Infinity;
  for (const c of palette) {
    const n = counts.get(c.toLowerCase()) ?? 0;
    if (n < min) { min = n; best = c; }
  }
  return best;
}
