/**
 * End-to-end RAG test:
 *   1. Take a question
 *   2. Embed it via Phaya
 *   3. Call match_knowledge() RPC in Supabase
 *   4. Print top matches with similarity scores
 *
 * Run: npx tsx test-rag.ts "คำถามของคุณ"
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PHAYA_API_KEY = process.env.PHAYA_API_KEY!;
const PHAYA_URL = process.env.PHAYA_API_URL
  ?? 'https://api.phaya.io/api/v1/embedding/create';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embed(text: string): Promise<number[]> {
  const res = await fetch(PHAYA_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PHAYA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [text] }),
  });
  if (!res.ok) throw new Error(`Phaya ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function main() {
  const queries = process.argv.slice(2);
  if (queries.length === 0) {
    queries.push(
      'คืนสินค้าได้กี่วัน',
      'มีใบกำกับภาษีไหม',
      'ส่งของไปต่างจังหวัดกี่วัน',
    );
  }

  for (const q of queries) {
    console.log(`\n━━━ "${q}" ━━━`);

    const t0 = Date.now();
    const queryEmbedding = await embed(q);
    const embedMs = Date.now() - t0;

    const t1 = Date.now();
    const { data, error } = await supabase.rpc('match_knowledge', {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: 3,
      filter_language: null,
      filter_visibility: 'public',
    });
    const matchMs = Date.now() - t1;

    if (error) {
      console.error('  ✗', error.message);
      continue;
    }

    console.log(`  embed: ${embedMs}ms | search: ${matchMs}ms | ${data?.length ?? 0} matches`);

    if (!data || data.length === 0) {
      console.log('  (no matches above threshold)');
      continue;
    }

    for (const m of data) {
      const score = (m.similarity as number).toFixed(3);
      const snippet = String(m.content).slice(0, 100).replace(/\n+/g, ' ');
      console.log(`  ${score}  ${m.source_path}#${m.chunk_index ?? '?'}`);
      console.log(`         "${snippet}..."`);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
