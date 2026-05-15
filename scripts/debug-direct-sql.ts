/**
 * Get embedding from rag-search (with debug) and call match_knowledge
 * directly via execute_sql with the same vector — verify if the issue
 * is in the SQL function or in the rpc serialization.
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // Get embedding via openai-embed
  const res = await fetch(`${SUPABASE_URL}/functions/v1/openai-embed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: ['มีใบกำกับภาษีไหม'] }),
  });
  const { embeddings } = await res.json() as { embeddings: number[][] };
  const emb = embeddings[0];

  console.log(`Embedding dim: ${emb.length}, first5: ${emb.slice(0,5).map(n=>n.toFixed(4)).join(',')}`);

  // Test 1: pass as array (what we've been doing)
  console.log('\n--- Test 1: pass as array via rpc ---');
  const r1 = await supabase.rpc('match_knowledge', {
    query_embedding: emb as unknown as string,
    match_threshold: 0,
    match_count: 3,
    filter_language: null,
    filter_visibility: 'public',
  });
  console.log('Top:', (r1.data as Array<{similarity:number;source_path:string}>)?.[0]?.similarity.toFixed(4), (r1.data as Array<{similarity:number;source_path:string}>)?.[0]?.source_path);

  // Test 2: pass as pgvector text format
  const embStr = '[' + emb.join(',') + ']';
  console.log('\n--- Test 2: pass as text "[1,2,...]" via rpc ---');
  const r2 = await supabase.rpc('match_knowledge', {
    query_embedding: embStr as unknown as string,
    match_threshold: 0,
    match_count: 3,
    filter_language: null,
    filter_visibility: 'public',
  });
  console.log('Top:', (r2.data as Array<{similarity:number;source_path:string}>)?.[0]?.similarity.toFixed(4), (r2.data as Array<{similarity:number;source_path:string}>)?.[0]?.source_path);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
