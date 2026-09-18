// Dev hot-reload: tsc --watch, asset copy, node --watch server restart.
import { spawn, execSync } from 'node:child_process';
import { watch, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, 'node_modules', '.bin');

// Build once so dist exists before the server starts.
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// Recompile TS to dist on source changes.
const tsc = spawn(path.join(bin, 'tsc'), ['--watch', '--preserveWatchOutput'],
  { cwd: root, stdio: 'inherit' });

// Copy views/public into dist on change; served fresh, no restart needed.
const copy = (from, to) => cpSync(path.join(root, from), path.join(root, to), { recursive: true });
let timer;
const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 100); };
watch(path.join(root, 'src', 'views'), { recursive: true },
  () => debounce(() => copy('src/views', 'dist/src/views')));
watch(path.join(root, 'public'), { recursive: true },
  () => debounce(() => copy('public', 'dist/public')));

// Restart server when compiled JS changes.
const server = spawn('node', ['--watch', 'dist/src/server.js'],
  { cwd: root, stdio: 'inherit' });

const shutdown = () => { tsc.kill(); server.kill(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
