// Run after: npm run build --workspace frontend -- --manifest
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = resolve(process.argv[2] || 'frontend/dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
const paths = ['index.html', 'src/pages/Shipping.tsx', 'src/pages/Ecommerce.tsx', 'src/pages/ImageStudio.tsx'];
const results = {};
for (const path of paths) {
  // Rollup may make a route a shared dynamic chunk when a lazy child also
  // imports its domain helpers; that entry is keyed by chunk rather than src.
  const routeKey = manifest[path] ? path : Object.keys(manifest).find(key =>
    manifest[key].isDynamicEntry && manifest[key].name === basename(path, '.tsx'));
  if (!routeKey) throw new Error(`Missing route: ${path}`);
  const visited = new Set();
  const assets = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing manifest entry: ${key}`);
    assets.add(chunk.file);
    for (const css of chunk.css || []) assets.add(css);
    for (const imported of chunk.imports || []) visit(imported);
  }
  visit(routeKey);
  const javascript = [...assets].filter(file => file.endsWith('.js'));
  const styles = [...assets].filter(file => file.endsWith('.css'));
  const bytes = file => readFileSync(resolve(dist, file));
  results[path] = {
    ownJsBytes: bytes(manifest[routeKey].file).length,
    initialJsBytes: javascript.reduce((sum, file) => sum + bytes(file).length, 0),
    initialJsGzipBytes: javascript.reduce((sum, file) => sum + gzipSync(bytes(file)).length, 0),
    initialJsFiles: javascript.length,
    fontStylesheetRequests: styles.reduce((sum, file) => sum + (bytes(file).toString().match(/@import[^;]*fonts\.googleapis\.com/g) || []).length, 0),
    fontFamilyDeclarations: styles.reduce((sum, file) => sum + (bytes(file).toString().match(/family=/g) || []).length, 0),
  };
}
console.log(JSON.stringify(results, null, 2));
