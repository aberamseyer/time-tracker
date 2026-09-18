import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

export interface BuildVersion {
  hash: string;
  builtAt: string;
}

// Written by scripts/copy-assets.js at build time.
function load(): BuildVersion {
  try {
    const raw = readFileSync(path.join(dir, '..', 'version.json'), 'utf8');
    return JSON.parse(raw) as BuildVersion;
  } catch {
    return { hash: 'dev', builtAt: new Date().toISOString() };
  }
}

export const version: BuildVersion = load();
