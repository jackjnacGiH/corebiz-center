/**
 * Re-embed all knowledge_chunks via the openai-embed Edge Function.
 * Ensures chunk embeddings and query embeddings (both from rag-search
 * Edge Function in iad1) live in the same vector space.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';
const EDGE_URL = `${SUPABASE_URL}/functions/v1/openai-embed`;
const BATCH = 20;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`openai-embed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings;
}

async function main() {
  const { data: rows, error } = await supabase
    .from('knowledge_chunks')
    .select('id, content')
    .order('source_path').order('chunk_index');
  if (error) throw error;

  const chunks = rows ?? [];
  console.log(`Re-embedding ${chunks.length} chunks via openai-embed Edge Function...`);

  let done = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const embeddings = await embedBatch(slice.map(c => c.content));

    for (let j = 0; j < slice.length; j++) {
      const { error: upErr } = await supabase
        .from('knowledge_chunks')
        .update({ embedding: embeddings[j] as unknown as string })
        .eq('id', slice[j].id);
      if (upErr) throw new Error(`update id=${slice[j].id}: ${upErr.message}`);
    }
    done += slice.length;
    console.log(`  ${done}/${chunks.length} re-embedded`);
  }
  console.log('✓ Done');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
