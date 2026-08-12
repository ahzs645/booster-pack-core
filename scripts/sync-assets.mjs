#!/usr/bin/env node
/**
 * Copies the pack assets into a consuming app's static directory.
 *
 * Both consumers serve files from their own public dir — Vite's `public/`, Next's
 * `frontend/public/` — and neither can serve out of a submodule directly. Rather
 * than symlink (which Next's static export follows inconsistently and Windows
 * checkouts refuse), the assets are copied on install and after every submodule
 * bump, and the destination is gitignored in both apps.
 *
 *   node scripts/sync-assets.mjs <target-public-dir>
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', 'assets', 'pack');

const target = process.argv[2];
if (!target) {
  console.error('usage: sync-assets.mjs <target-public-dir>');
  process.exit(1);
}

const dest = join(resolve(target), 'pack');

try {
  await stat(source);
} catch {
  console.error(`pack assets missing at ${source} — is the submodule checked out?`);
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await mkdir(dirname(dest), { recursive: true });
await cp(source, dest, { recursive: true });
console.log(`pack assets → ${dest}`);
