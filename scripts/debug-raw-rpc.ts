/**
 * Test calling match_knowledge via raw fetch from Node — should match
 * what the Edge Function does. If Node raw fetch gives different result
 * than Edge raw fetch, the HTTP body differs in some way.
 */
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93b2VkY2NtdXFuemR0eHZ5d2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTMyOTQsImV4cCI6MjA4NzkyOTI5NH0.OfOaHTsJx-M36N5G54PjC4n-8-qZVQNVUuLdb10RO4M';

async function main() {
  // Get embedding via openai-embed (same as Edge Function)
  const embRes = await fetch(`${SUPABASE_URL}/functions/v1/openai-embed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ANON_JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: ['มีใบกำกับภาษีไหม'] }),
  });
  const { embeddings } = await embRes.json() as { embeddings: number[][] };
  const emb = embeddings[0];
  const embStr = '[' + emb.join(',') + ']';

  console.log('Embedding first5:', emb.slice(0, 5).map(n => n.toFixed(6)));

  // Now call match_knowledge via raw fetch (same as Edge Function v10)
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_embedding: embStr,
      match_threshold: 0,
      match_count: 3,
      filter_language: null,
      filter_visibility: 'public',
    }),
  });
  const data = await rpcRes.json() as Array<{ similarity: number; source_path: string; content: string }>;
  console.log(`\nRaw fetch from Node (same path as Edge Function):`);
  for (const m of data) {
    console.log(`  ${m.similarity.toFixed(4)}  ${m.source_path}  "${m.content.slice(0, 50)}..."`);
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
