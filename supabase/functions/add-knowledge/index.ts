/**
 * Edge Function: add-knowledge v2
 *
 * v2 change: write user's chosen category to the dedicated `category`
 * column (added in migration knowledge_chunks_add_category_column).
 * Previously it was only embedded in source_path folder + metadata, which
 * made category filtering/editing unreliable.
 *
 * Body: {
 *   title: string,
 *   content: string (markdown),
 *   source_path?: string (defaults to <category>/YYYY-MM/slug.md),
 *   category?: string,  // user-facing topic: products | policies | faq | ...
 *   tags?: string[],
 *   language?: 'th' | 'en' | 'mixed',
 *   visibility?: 'public' | 'internal',
 * }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CHUNK_MAX_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ReqBody {
  title: string;
  content: string;
  source_path?: string;
  category?: string;
  tags?: string[];
  language?: 'th' | 'en' | 'mixed';
  visibility?: 'public' | 'internal';
}

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/[^\w฀-๿\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function tailTokens(text: string, tokens: number): string {
  const cc = tokens * 3;
  return text.length > cc ? text.slice(text.length - cc) : '';
}

function chunkMarkdown(md: string): string[] {
  const trimmed = md.trim();
  if (!trimmed) return [];

  const sections = trimmed.split(/(?=^##\s)/m).map(s => s.trim()).filter(Boolean);
  const sects = sections.length > 0 ? sections : [trimmed];

  const result: string[] = [];
  for (const sec of sects) {
    if (approxTokens(sec) <= CHUNK_MAX_TOKENS) {
      result.push(sec);
      continue;
    }
    const paragraphs = sec.split(/\n\n+/);
    let buf = '';
    let bufTokens = 0;
    for (const para of paragraphs) {
      const pT = approxTokens(para);
      if (bufTokens + pT > CHUNK_MAX_TOKENS && buf) {
        result.push(buf.trim());
        const overlap = tailTokens(buf, CHUNK_OVERLAP_TOKENS);
        buf = overlap ? overlap + '\n\n' + para : para;
        bufTokens = approxTokens(buf);
      } else {
        buf = buf ? buf + '\n\n' + para : para;
        bufTokens += pT;
      }
    }
    if (buf.trim()) result.push(buf.trim());
  }
  return result;
}

async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function embedTexts(texts: string[], jwt: string): Promise<number[][]> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/openai-embed`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`openai-embed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');

    const body = await req.json() as ReqBody;
    if (!body.title?.trim() || !body.content?.trim()) {
      return new Response(JSON.stringify({ error: 'title and content are required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const category = body.category?.trim() || 'manual';
    const slug = slugify(body.title) || `note-${Date.now()}`;
    const source_path = body.source_path?.trim() || `${category}/${yyyy}-${mm}/${slug}.md`;

    const chunks = chunkMarkdown(body.content);
    if (chunks.length === 0) {
      return new Response(JSON.stringify({ error: 'content produced no chunks' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const embeddings = await embedTexts(chunks, jwt);

    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/knowledge_chunks?source_path=eq.${encodeURIComponent(source_path)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
        },
      },
    );
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`delete failed: ${delRes.status}: ${await delRes.text()}`);
    }

    const rows = await Promise.all(chunks.map(async (c, i) => ({
      source_path,
      source_type: 'manual',
      category,
      title: body.title,
      content: c,
      metadata: { added_via: 'web_admin' },
      embedding: '[' + embeddings[i].join(',') + ']',
      language: body.language ?? 'th',
      chunk_index: i,
      content_hash: await sha256(c),
      token_count: Math.ceil(c.length / 3),
      tags: body.tags ?? [],
      visibility: body.visibility ?? 'public',
    })));

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_chunks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(rows),
    });
    if (!insRes.ok) throw new Error(`insert failed: ${insRes.status}: ${await insRes.text()}`);
    const inserted = await insRes.json();

    return new Response(
      JSON.stringify({
        source_path,
        category,
        chunks_count: chunks.length,
        ids: (inserted as Array<{ id: string }>).map(r => r.id),
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('add-knowledge error:', err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? 'internal error' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    );
  }
});

