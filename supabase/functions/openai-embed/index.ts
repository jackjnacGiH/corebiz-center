/**
 * Edge Function: openai-embed
 * Batch embedding via OpenAI text-embedding-3-small (1536 dim).
 * Consistent embeddings across regions (unlike Phaya).
 *
 * Body: { texts: string[], model?: string }
 * Returns: { embeddings: number[][], dim: number, model: string, tokens: number, elapsed_ms: number }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const DEFAULT_MODEL = Deno.env.get('OPENAI_EMBED_MODEL') ?? 'text-embedding-3-small';

import { requireStaff, embeddingInputError } from '../_shared/staff-auth.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await requireStaff(admin, req, ["owner","admin"], Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY is not set in Edge Function secrets' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json() as { texts: string[]; model?: string };
    const inputError = embeddingInputError(body.texts, body.model, DEFAULT_MODEL);
    if (inputError) return new Response(JSON.stringify({ error: inputError }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const { data: withinBudget, error: budgetError } = await admin.rpc('consume_embedding_budget_internal', { p_actor_id: auth.actor.id, p_characters: body.texts.reduce((n,t) => n+t.length,0) });
    if (budgetError || !withinBudget) return new Response(JSON.stringify({ error: budgetError ? 'embedding_budget_unavailable' : 'embedding_rate_limited' }), { status: budgetError ? 503 : 429, headers: { ...CORS, 'Content-Type': 'application/json' } });
    const model = DEFAULT_MODEL;
    const t0 = Date.now();

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: body.texts, model }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      data: Array<{ embedding: number[]; index: number }>;
      usage: { total_tokens: number };
      model: string;
    };

    // OpenAI returns out-of-order results; sort by index
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    const embeddings = sorted.map(d => d.embedding);

    return new Response(
      JSON.stringify({
        embeddings,
        dim: embeddings[0]?.length ?? 0,
        model: data.model,
        tokens: data.usage.total_tokens,
        elapsed_ms: Date.now() - t0,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('openai-embed error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'internal error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});
