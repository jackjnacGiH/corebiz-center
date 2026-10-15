// Additive product-list variants. Original files and DB image URLs are untouched.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const [urlsFile, keysFile, outputDir, mode = 'dry-run'] = process.argv.slice(2);
if (!urlsFile || !keysFile || !outputDir) throw new Error('Usage: node scripts/optimize-product-images.mjs urls.json keys.json output-dir [upload]');
const project = 'owoedccmuqnzdtxvywgt';
const base = `https://${project}.supabase.co`;
const keys = JSON.parse(await readFile(keysFile, 'utf8'));
const key = keys.find(key => key.name === 'service_role')?.api_key;
if (!key) throw new Error('Storage service key unavailable');
const db = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
const urls = JSON.parse(await readFile(urlsFile, 'utf8'));
const results = [], manifest = {};
await mkdir(outputDir, { recursive: true });
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < urls.length) {
    const url = urls[next++];
    try {
      const parsed = new URL(url);
      if (parsed.origin !== base || !parsed.pathname.startsWith('/storage/v1/object/public/products/')) throw new Error('Unrecognized image origin');
      const path = decodeURIComponent(parsed.pathname.slice('/storage/v1/object/public/products/'.length));
      if (path.startsWith('org/') || path.startsWith('optimized/')) continue;
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      const metadata = await sharp(original, { animated: true }).metadata();
      if ((metadata.pages ?? 1) > 1 || original.length < 90_000) continue;
      // 960px is ample for list cards, even on high-density screens. Zoom uses original.
      const optimized = await sharp(original).rotate().resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88, effort: 5 }).toBuffer();
      if (optimized.length > original.length * 0.85) continue;
      const hash = createHash('sha256').update(original).update('960-q88-v1').digest('hex').slice(0, 24);
      const variant = `optimized/list-v1/${hash}.webp`;
      if (mode === 'upload') {
        const { error } = await db.storage.from('products').upload(variant, optimized, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
        if (error && !['409', 'Duplicate'].includes(String(error.statusCode ?? error.error))) throw new Error(`Variant upload failed: ${error.statusCode ?? 'unknown'}`);
      }
      manifest[path] = variant;
      results.push({ path, variant, original: original.length, optimized: optimized.length, width: metadata.width, height: metadata.height });
    } catch (error) { results.push({ url, error: error.message }); }
  }
}));
await writeFile(`${outputDir}/product-image-variants.json`, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + '\n');
await writeFile(`${outputDir}/image-report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ mode, inputs: urls.length, optimized: Object.keys(manifest).length,
  originalBytes: results.reduce((n, row) => n + (row.original ?? 0), 0), variantBytes: results.reduce((n, row) => n + (row.optimized ?? 0), 0),
  errors: results.filter(row => row.error).length }));
