import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

// Capture build version; git is unavailable at runtime on the VPS.
let hash = 'unknown';
try {
  hash = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  // no git; keep fallback
}
writeFileSync(
  path.join(dist, 'version.json'),
  JSON.stringify({ hash, builtAt: new Date().toISOString() })
);

// Views EJS live beside the compiled app at dist/src/views.
rmSync(path.join(dist, 'src', 'views'), { recursive: true, force: true });
cpSync(path.join(root, 'src', 'views'), path.join(dist, 'src', 'views'), { recursive: true });

// app.ts resolves static at ../public -> dist/public.
rmSync(path.join(dist, 'public'), { recursive: true, force: true });
cpSync(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });

console.log('assets copied to dist');
