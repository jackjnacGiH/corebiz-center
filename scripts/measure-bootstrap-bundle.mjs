import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const label = process.argv[2] ?? 'current';
if (!/^[a-z-]+$/.test(label)) throw new Error('Use a simple measurement label');
const html = readFileSync('frontend/dist/index.html', 'utf8');
const entry = html.match(/src="\/center\/assets\/([^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Build entry not found');
const seen = new Set();
function walk(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const source = readFileSync(join('frontend/dist/assets', name), 'utf8');
  // Include static dependencies recursively, excluding import() so merely
  // moving bytes to an eagerly loaded sibling cannot appear as an improvement.
  for (const match of source.matchAll(/\b(?:import|export)(?!\s*\()\s*(?:[^;]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g)) walk(match[1]);
}
walk(entry);
const files = [...seen].map(name => {
  const bytes = readFileSync(join('frontend/dist/assets', name));
  return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
});
const result = { label, lockfileSha256: createHash('sha256').update(readFileSync('package-lock.json')).digest('hex'), entry, files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  limit: 'Boot entry and its static JS dependency graph; excludes lazy route/dialog imports and measures bytes rather than network latency.' };
mkdirSync('output/audit-three-groups', { recursive: true });
writeFileSync(`output/audit-three-groups/frontend-bootstrap-${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
