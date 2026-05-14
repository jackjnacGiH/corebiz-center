/**
 * Quick Phaya embedding test — verify API key and vector dimension.
 * Run: npx tsx test-phaya.ts
 */
import 'dotenv/config';

const PHAYA_API_KEY = process.env.PHAYA_API_KEY;
const PHAYA_API_URL = process.env.PHAYA_API_URL
  ?? 'https://api.phaya.io/api/v1/embedding/create';

if (!PHAYA_API_KEY) {
  console.error('Missing PHAYA_API_KEY in scripts/.env');
  process.exit(1);
}

async function main() {
  console.log(`Phaya endpoint: ${PHAYA_API_URL}`);
  console.log('Sending test input (Thai + English)...\n');

  const t0 = Date.now();
  const res = await fetch(PHAYA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PHAYA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: [
        'ทดสอบการ embedding ภาษาไทยสำหรับระบบ CoreBiz',
        'Hello from CoreBiz Center',
      ],
    }),
  });

  const ms = Date.now() - t0;

  if (!res.ok) {
    console.error(`✗ HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const data = await res.json() as {
    data?: Array<{ embedding: number[] }>;
    [k: string]: unknown;
  };

  if (!data.data || data.data.length === 0) {
    console.error('✗ No embeddings returned. Raw response:');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const dim = data.data[0].embedding.length;
  const dim2 = data.data[1]?.embedding.length;

  console.log(`✓ HTTP 200 in ${ms}ms`);
  console.log(`✓ Got ${data.data.length} embedding(s)`);
  console.log(`✓ Vector dimension: ${dim}`);
  if (dim2 !== undefined && dim2 !== dim) {
    console.warn(`⚠ Dimensions differ between inputs: ${dim} vs ${dim2}`);
  }
  console.log(`✓ Sample values (first 5): [${data.data[0].embedding.slice(0, 5).map(n => n.toFixed(4)).join(', ')}, ...]`);

  console.log('\n─────────────────────────────────────');
  if (dim === 1024) {
    console.log('✅ Dimension matches schema (vector(1024)) — ready to sync!');
  } else {
    console.log(`⚠️ Schema is vector(1024) but Phaya returns vector(${dim})`);
    console.log(`   Need to update knowledge_chunks.embedding to vector(${dim}) before sync.`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
