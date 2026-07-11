/**
 * Edge Function: rag-search v10
 * Calls the openai-embed Edge Function for query embedding so it
 * uses the EXACT same code path as chunk embedding (no batch/single
 * mismatch). Avoids Deno-specific OpenAI fetch quirks.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ReqBody {
  query: string;
  match_count?: number;
  match_threshold?: number;
  language?: string | null;
  debug?: boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function embedViaSelfFn(text: string, jwt: string): Promise<{ embedding: number[]; tokens: number }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/openai-embed`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ texts: [text] }),
  });
  if (!res.ok) throw new Error(`openai-embed ${res.status}: ${await res.text()}`);
  const data = await res.json() as {
    embeddings: number[][];
    tokens?: number;
  };
  return { embedding: data.embeddings[0], tokens: data.tokens ?? 0 };
}

async function rpcMatchKnowledge(params: {
  query_embedding: string;
  match_threshold: number;
  match_count: number;
  filter_language: string | null;
  filter_visibility: string;
}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_knowledge`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`);
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    // Extract caller's JWT to forward to openai-embed
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');

    const body = await req.json() as ReqBody;
    if (!body.query) {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const t0 = Date.now();
    const { embedding, tokens } = await embedViaSelfFn(body.query, jwt);
    const embed_ms = Date.now() - t0;

    const embStr = '[' + embedding.join(',') + ']';

    const t1 = Date.now();
    const matches = await rpcMatchKnowledge({
      query_embedding: embStr,
      match_threshold: body.match_threshold ?? 0.4,
      match_count: body.match_count ?? 5,
      filter_language: body.language ?? null,
      filter_visibility: 'public',
    });
    const search_ms = Date.now() - t1;

    return new Response(
      JSON.stringify({
        matches: matches ?? [],
        embed_ms,
        search_ms,
        tokens,
        model: 'text-embedding-3-small',
        debug: body.debug ? {
          dim: embedding.length,
          first5: embedding.slice(0, 5).map(n => Number(n.toFixed(6))),
        } : undefined,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('rag-search error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'internal error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});

