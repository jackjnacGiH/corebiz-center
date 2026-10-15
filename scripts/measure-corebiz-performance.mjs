import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const label = process.argv[2];
if (!['before', 'after'].includes(label)) throw new Error('Use before or after');
const dist = process.argv[3] ?? 'frontend/dist';
const dir = `${dist}/assets`;
const html = readFileSync(`${dist}/index.html`, 'utf8');
const entry = html.match(/src="[^" ]*\/([^/" ]+\.js)"/)[1];
const all = readdirSync(dir);
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  limit: 'Built static JS dependency graph, excluding lazy imports. Bytes, not end-user latency.', routes: {} };
for (const route of ['index', 'CRM', 'Inventory', 'Orders', 'Ecommerce', 'Dashboard', 'Chat', 'Shipping']) {
  const file = route === 'index' ? entry : all.find(n => n.startsWith(`${route}-`) && n.endsWith('.js'));
  if (!file) continue;
  const seen = new Set();
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const source = readFileSync(`${dir}/${name}`, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)(?!\s*\()\s*(?:[^;]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g)) visit(match[1]);
  }
  visit(file);
  result.routes[route] = { file, files: [...seen],
    bytes: [...seen].reduce((sum, n) => sum + statSync(`${dir}/${n}`).size, 0),
    gzip: [...seen].reduce((sum, n) => sum + gzipSync(readFileSync(`${dir}/${n}`)).length, 0) };
}
mkdirSync('output/performance-2026-10-15', { recursive: true });
writeFileSync(`output/performance-2026-10-15/bundle-${label}.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.routes).map(([k,v]) => [k, {bytes:v.bytes,gzip:v.gzip,files:v.files.length}]))));
