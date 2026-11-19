// Prebuilt static variants: no Storage writes and no request-time image transforms.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import sharp from 'sharp';
import { supabase } from '../lib/supabase.ts';

const root = new URL('../', import.meta.url);
const manifestFile = new URL('lib/catalog-image-manifest.json', root);
const reportFile = new URL('image-preparation-report.json', root);
const output = new URL('public/catalog-images/', root);
const widths = [320, 640, 960];
const allowedOrigin = 'https://owoedccmuqnzdtxvywgt.supabase.co';
const dryRun = process.argv.includes('--dry-run');
let previous = {};
try { previous = JSON.parse(await readFile(manifestFile, 'utf8')); } catch { /* first run */ }

async function readAll(table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const [products, groups] = await Promise.all([
  readAll('storefront_products', 'id,images'),
  readAll('product_groups', 'id,cover_image'),
]);
const urls = [...new Set([
  ...products.flatMap(p => p.images ?? []),
  ...groups.map(g => g.cover_image).filter(Boolean),
])].filter(src => {
  try {
    const url = new URL(src);
    return url.origin === allowedOrigin && !url.search && !url.hash &&
      /^\/storage\/v1\/object\/public\/(products|product-groups)\//.test(url.pathname) &&
      !url.pathname.includes('/products/org/');
  } catch { return false; }
}).sort();

console.log(JSON.stringify({ products: products.length, groups: groups.length, uniquePublicImages: urls.length, dryRun }));
if (dryRun) process.exit(0);
await mkdir(output, { recursive: true });
const manifest = {}, errors = [];
let next = 0, completed = 0, reused = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < urls.length) {
    const src = urls[next++];
    try {
      const known = previous[src];
      if (known && !process.argv.includes('--refresh')) {
        await Promise.all(known.sources.map(s => access(new URL(`public${s.src}`, root))));
        manifest[src] = known;
        reused++;
        continue;
      }
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(src, { signal: AbortSignal.timeout(30000) });
        if (response.ok || response.status < 500) break;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      if (original.length > 25 * 1024 * 1024) throw new Error('source exceeds 25 MB');
      const metadata = await sharp(original, { animated: true }).metadata();
      if ((metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) continue;
      const rotated = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
      const hash = createHash('sha256').update(original).update('static-webp-q82-v1').digest('hex').slice(0, 24);
      const sources = [];
      const targetWidths = [...new Set(widths.map(w => Math.min(w, rotated.info.width)))];
      for (const width of targetWidths) {
        const { data, info } = await sharp(rotated.data).resize({ width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 5 }).toBuffer({ resolveWithObject: true });
        const filename = `${hash}-${width}.webp`;
        await writeFile(new URL(filename, output), data);
        sources.push({ width: info.width, src: `/catalog-images/${filename}`, bytes: data.length });
      }
      manifest[src] = { width: rotated.info.width, height: rotated.info.height, originalBytes: original.length, sources };
      completed++;
      if (completed % 50 === 0) console.log(`Prepared ${completed} images`);
    } catch (error) { errors.push({ src, error: error.message }); }
  }
}));
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestFile, `${JSON.stringify(sorted, null, 2)}\n`);
const report = { prepared: completed, reused, entries: Object.keys(sorted).length,
  originalBytes: Object.values(sorted).reduce((n, e) => n + e.originalBytes, 0),
  staticBytes: Object.values(sorted).reduce((n, e) => n + e.sources.reduce((sum, s) => sum + s.bytes, 0), 0),
  errors };
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
// Explicit acknowledgement is required for pre-existing unavailable sources.
// Those URLs remain unchanged and are not replaced with an unrelated photo.
if (errors.length && !process.argv.includes('--allow-unavailable')) process.exitCode = 1;
