/**
 * Test the new OpenAI RAG pipeline end-to-end against match_knowledge.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embed(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, model: MODEL }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function main() {
  const queries = [
    'คืนสินค้าได้กี่วัน',
    'มีใบกำกับภาษีไหม',
    'ส่งของไปต่างจังหวัดกี่วัน',
    'สมัครเป็นตัวแทนได้ไหม',
    'รับบัตรเครดิตไหม',
  ];

  for (const q of queries) {
    console.log(`\n━━━ "${q}" ━━━`);
    const t0 = Date.now();
    const emb = await embed(q);
    const eMs = Date.now() - t0;

    const t1 = Date.now();
    const { data, error } = await supabase.rpc('match_knowledge', {
      query_embedding: emb as unknown as string,
      match_threshold: 0.3,
      match_count: 3,
      filter_language: null,
      filter_visibility: 'public',
    });
    const sMs = Date.now() - t1;
    if (error) { console.error('  err:', error.message); continue; }
    console.log(`  ⚡ ${eMs}ms · 🔍 ${sMs}ms · ${(data ?? []).length} matches`);
    for (const m of (data ?? []) as Array<{ similarity: number; source_path: string; content: string }>) {
      console.log(`    ${m.similarity.toFixed(3)}  ${m.source_path}`);
      console.log(`           "${m.content.slice(0, 90).replace(/\n/g, ' ')}..."`);
    }
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
