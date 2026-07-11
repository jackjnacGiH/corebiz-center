/**
 * replace-knowledge v3
 *
 * v3 fix: write user's chosen category to the dedicated `category` column
 * (added in migration knowledge_chunks_add_category_column). v2 wrote it
 * only to metadata.category which the frontend list view didn't read —
 * so category changes appeared lost on reload.
 *
 * source_type stays preserved from existing chunks (constrained to
 * 'obsidian'|'manual'|'upload'|'crawl'). source_path is intentionally
 * NOT renamed when category changes — stable links matter.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_EMBED_MODEL = "text-embedding-3-small";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReqBody {
  source_path: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  language?: "th" | "en" | "mixed";
  visibility?: "public" | "internal";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body: ReqBody = await req.json();
    const source_path = (body.source_path ?? "").trim();
    const title       = (body.title ?? "").trim();
    const content     = (body.content ?? "").trim();
    const category    = (body.category ?? "manual").trim() || "manual";
    const tags        = body.tags       ?? [];
    const language    = body.language   ?? "th";
    const visibility  = body.visibility ?? "public";

    if (!source_path) return jsonError("source_path required", 400);
    if (!title)       return jsonError("title required", 400);
    if (!content)     return jsonError("content required", 400);

    const openaiKey = await readSecret(admin, "OPENAI_API_KEY");
    if (!openaiKey) {
      return jsonError("OPENAI_API_KEY ยังไม่ได้ตั้ง — Settings → Integrations", 500);
    }

    // Preserve original source_type (constrained to ingestion mechanism).
    let source_type = "manual";
    {
      const { data: existing } = await admin
        .from("knowledge_chunks")
        .select("source_type")
        .eq("source_path", source_path)
        .limit(1)
        .maybeSingle();
      if (existing?.source_type) source_type = existing.source_type as string;
    }

    const { error: delErr } = await admin
      .from("knowledge_chunks")
      .delete()
      .eq("source_path", source_path);
    if (delErr) throw delErr;

    const sections = chunkByH2(content);
    if (sections.length === 0) {
      return jsonError("ไม่มีเนื้อหาหลังแยก chunks", 400);
    }

    const embeddings = await embedBatchOpenAI(
      openaiKey,
      sections.map((s) => s.body),
    );

    const now = new Date().toISOString();
    const rows = sections.map((s, i) => ({
      source_path,
      source_type,
      category,
      title,
      content: s.body,
      chunk_index: i,
      language,
      visibility,
      tags,
      token_count: estimateTokens(s.body),
      content_hash: simpleHash(source_path + "#" + i + ":" + s.body),
      metadata: {
        section_heading: s.heading ?? null,
        updated_via: "replace-knowledge",
      },
      embedding: embeddings[i],
      created_at: now,
      updated_at: now,
    }));

    const { error: insErr } = await admin.from("knowledge_chunks").insert(rows);
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        source_path,
        source_type,
        category,
        chunks_count: sections.length,
        total_tokens: rows.reduce((acc, r) => acc + (r.token_count ?? 0), 0),
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  } catch (e) {
    console.error("replace-knowledge error:", e);
    return jsonError((e as Error).message ?? String(e), 500);
  }
});

async function readSecret(admin: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: name });
  if (error) {
    console.warn(`readSecret(${name}) failed:`, error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

function chunkByH2(content: string): Array<{ heading: string | null; body: string }> {
  const lines = content.split(/\r?\n/);
  const out: Array<{ heading: string | null; body: string }> = [];
  let curHeading: string | null = null;
  let curBuf: string[] = [];

  const flush = () => {
    const body = curBuf.join("\n").trim();
    if (body) out.push({ heading: curHeading, body: (curHeading ? `## ${curHeading}\n\n` : "") + body });
    curBuf = [];
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      curHeading = m[1].trim();
    } else {
      curBuf.push(line);
    }
  }
  flush();

  if (out.length === 0 && content.trim()) {
    out.push({ heading: null, body: content.trim() });
  }
  return out;
}

async function embedBatchOpenAI(apiKey: string, inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: inputs, model: OPENAI_EMBED_MODEL }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return ((data?.data ?? []) as Array<{ embedding: number[] }>).map((d) => d.embedding);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

