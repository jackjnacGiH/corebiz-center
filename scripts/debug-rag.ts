/**
 * Diagnose: are query+chunk embeddings actually in the same space?
 * Calls openai-embed Edge Function for query, then computes cosine
 * similarity against each stored chunk via direct SQL.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function embedViaEdge(text: string): Promise<number[]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/openai-embed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [text] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings[0];
}

async function main() {
  const query = 'มีใบกำกับภาษีไหม';
  const qEmb = await embedViaEdge(query);
  console.log(`Query: "${query}"`);
  console.log(`First5: ${qEmb.slice(0, 5).map(n => n.toFixed(6)).join(', ')}`);

  // Direct SQL: compute similarity with the chunk that should match
  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: qEmb as unknown as string,
    match_threshold: 0,
    match_count: 12,
    filter_language: null,
    filter_visibility: 'public',
  });
  if (error) throw error;

  console.log('\nResults via match_knowledge (same query, same DB):');
  for (const m of (data ?? []) as Array<{ similarity: number; source_path: string; content: string }>) {
    console.log(`  ${m.similarity.toFixed(4)}  ${m.source_path}  "${m.content.slice(0, 50).replace(/\n/g, ' ')}..."`);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
