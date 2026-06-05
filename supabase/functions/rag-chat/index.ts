/**
 * rag-chat v25 — three-level bot pause (per-chat, per-channel, global)
 *
 * Before generating any LLM reply, check three boolean flags:
 *   1. org_settings.bot_enabled        — global kill-switch
 *   2. ai_personas[channel].bot_enabled — per-channel pause (LINE / web / ...)
 *   3. chat_conversations[id].bot_enabled — per-conversation pause
 *
 * If ANY is false: emit `{type:'paused'}` SSE event (widget removes its
 * placeholder bubble) and a `done` event with no text. The customer message
 * is still saved (it was inserted before handleQuery ran) so admin sees it
 * in the inbox and can reply manually. Each flag cached 30s in memory.
 *
 * v25: never say "ไม่พบ/ไม่มี" — out-of-stock & not-found pivot to suggesting
 * nearby products / made-to-order / forwarding to Khun Cherry (TOOLING_GUIDE
 * rules 4-6 + reworded find_products fuzzy note).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";
const MAX_TOOL_ITERATIONS = 5;
const RETRY_PER_MODEL = 5;
const DEFAULT_MATCH_COUNT = 5;
const DEFAULT_MATCH_THRESHOLD = 0.3;
const MAX_CONTEXT_CHUNKS = 30;
const PERSONA_CACHE_TTL_MS = 60_000;
const KEYWORD_CACHE_TTL_MS = 60_000;
const BOT_FLAG_CACHE_TTL_MS = 30_000;
const ALLOWED_CHANNELS = new Set(["default", "line", "web"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

let cachedGeminiKey: string | null = null;
let cachedOpenAIKey: string | null = null;
const personaCache = new Map<string, { prompt: string; expires: number }>();

interface KeywordRow { canonical: string; aliases: string[]; }
interface RewritePair { alias: string; canonical: string; }
let keywordCache: { pairs: RewritePair[]; expires: number } | null = null;

// Bot flag caches (per scope). Conversation flags keyed by conv id.
let globalBotCache: { enabled: boolean; expires: number } | null = null;
const channelBotCache = new Map<string, { enabled: boolean; expires: number }>();
const convBotCache = new Map<string, { enabled: boolean; expires: number }>();

type Lang = "th" | "en";
function detectLanguage(s: string): Lang {
  return /[฀-๿]/.test(s) ? "th" : "en";
}

const MSG = {
  th: {
    costRefusal: "ขออภัยค่ะ ข้อมูลราคาทุน / ต้นทุน / margin เป็นข้อมูลภายในของบริษัท ไม่สามารถเปิดเผยได้ค่ะ\n\nหากต้องการทราบราคาขาย, รายละเอียดสินค้า, สต็อกคงเหลือ สามารถถามได้เลยนะคะ 😊",
    noAnswer: "ขออภัย ยังไม่สามารถตอบคำถามนี้ได้ รบกวนลองพิมพ์ใหม่อีกครั้งหรือติดต่อทีมงานครับ",
    geminiKeyMissing: "GEMINI_API_KEY ยังไม่ได้ตั้ง",
    openaiKeyMissing: "OPENAI_API_KEY ยังไม่ได้ตั้ง",
    queryRequired: "กรุณาพิมพ์คำถาม",
    invalidJson: "รูปแบบคำขอไม่ถูกต้อง",
    aiBusy: "ขณะนี้ระบบ AI มีผู้ใช้งานเยอะ ลองถามใหม่อีกสักครู่นะคะ",
    maxIterations: "ขออภัย ระบบประมวลผลยาวเกินไป",
  },
  en: {
    costRefusal: "Sorry, but cost / margin information is internal company data and cannot be disclosed.\n\nIf you'd like to know the selling price, product details, or available stock, please ask — happy to help! 😊",
    noAnswer: "Sorry, I couldn't generate an answer for that. Please try rephrasing or contact our team.",
    geminiKeyMissing: "GEMINI_API_KEY is not configured",
    openaiKeyMissing: "OPENAI_API_KEY is not configured",
    queryRequired: "Please enter a question",
    invalidJson: "Invalid request format",
    aiBusy: "The AI service is busy right now.",
    maxIterations: "Sorry, the request took too long.",
  },
} as const;

const TH = String.fromCharCode;
const KW_RAKHATUN = TH(0x0E23, 0x0E32, 0x0E04, 0x0E32, 0x0E17, 0x0E38, 0x0E19);
const KW_TONTUN   = TH(0x0E15, 0x0E49, 0x0E19, 0x0E17, 0x0E38, 0x0E19);
const KW_RAKHASUE = TH(0x0E23, 0x0E32, 0x0E04, 0x0E32, 0x0E0B, 0x0E37, 0x0E49, 0x0E2D);
const KW_RAKHAKHAO = TH(0x0E23, 0x0E32, 0x0E04, 0x0E32, 0x0E40, 0x0E02, 0x0E49, 0x0E32);
const THAI_COST_KEYWORDS = [KW_RAKHATUN, KW_TONTUN, KW_RAKHASUE, KW_RAKHAKHAO];
const ASCII_COST_PATTERNS = [/\bcost\b/i, /\bmargin\b/i, /\bbuying\s+price\b/i, /\bbuy\s+price\b/i];
function isCostQuery(s: string): boolean {
  if (!s) return false;
  for (const kw of THAI_COST_KEYWORDS) if (s.indexOf(kw) !== -1) return true;
  for (const re of ASCII_COST_PATTERNS) if (re.test(s)) return true;
  return false;
}

const STOPWORDS = new Set([
  "ขอ", "ขอดู", "ขอดูรูป", "ดู", "ดูหน่อย", "หน่อย", "นะคะ", "นะครับ", "น่ะ",
  "ครับ", "ค่ะ", "ค่า", "จ้า", "จ้ะ", "ฮะ", "นะ",
  "ไหม", "มั้ย", "บ้าง", "บ้า", "หรือเปล่า", "หรือไม่", "ไหน",
  "รูป", "รูปภาพ", "ภาพ", "ราคา", "สต็อก", "รายละเอียด",
  "เท่าไหร่", "เท่าไร", "เท่าไหร", "มี", "ของ", "ใน", "ระบบ",
  "อันไหน", "ตัว", "ชิ้น", "ส่ง",
  "show", "me", "please", "can", "see", "picture", "image", "photo",
  "price", "stock", "how", "much", "what", "is", "are",
  "a", "the", "this", "that", "those", "these", "of", "for", "to", "at", "in", "on",
  "available", "do", "you", "have", "want", "give", "send", "any",
  "and", "or", "with",
]);
function stripStopWords(tokens: string[]): string[] {
  const filtered = tokens.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  return filtered.length > 0 ? filtered : tokens;
}

const PRODUCT_HINT_RE = [/\b\d{7,}\b/, /MIRKA|mirka/, /\bCS\d+/i, /\bXA\d+/i, /#\d+/, /สต็อก/, /รูปสินค้า/];
const FAQ_HINT_RE = [
  /คืนสินค้า/, /ใบกำกับ/, /ภาษี/, /ตัวแทน/, /สมัคร/, /นโยบาย/, /ส่งของ/, /บัตรเครดิต/, /จัดส่ง/,
  /ที่อยู่/, /ที่ตั้ง/, /โรงงาน/, /แผนที่/, /location/i, /เบอร์โทร/, /เบอร์บัญชี/, /email/i, /ติดต่อ/, /เปิดทำ/, /วันหยุด/,
  /\breturn\b/i, /\binvoice\b/i, /\btax\b/i, /\bagent\b/i, /\bpolicy\b/i, /\bshipping\b/i, /\bcredit\s*card\b/i, /\baddress\b/i, /\bphone\b/i, /\bopening\s*hour/i,
];
function shouldSkipRAG(query: string): boolean {
  const hasFaq = FAQ_HINT_RE.some((p) => p.test(query));
  if (hasFaq) return false;
  const hasProduct = PRODUCT_HINT_RE.some((p) => p.test(query));
  return hasProduct;
}

const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      { name: "find_products", description: "Search products. Multi-word AND on (sku, name_th, name_en, brand). Stop-words are stripped server-side. Each result includes min_order_qty. Query is auto-rewritten using keyword_synonyms before search (alias → canonical). If result contains clarification_candidates the customer used an unrecognised name — ask which product they mean.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "get_product_detail", description: "Full product detail by SKU, including min_order_qty.", parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } },
      { name: "list_product_groups", description: "All product groups.", parameters: { type: "object", properties: {} } },
      { name: "get_group_members", description: "SKUs in a product group.", parameters: { type: "object", properties: { group_name: { type: "string" } }, required: ["group_name"] } },
      { name: "list_categories", description: "All product categories.", parameters: { type: "object", properties: {} } },
    ],
  },
];

const PRODUCT_COLUMNS_CUSTOMER = "sku, name_th, name_en, brand, price, discount_value, discount_type, unit, status, weight_kg, feature_tags, tags, barcode, images, min_order_qty";

function computeEffectivePrice(p: { price: unknown; discount_value: unknown; discount_type: unknown }) {
  const base = Number(p.price ?? 0);
  const val = Number(p.discount_value ?? 0);
  if (!val) return { effective: base, discounted: false };
  const off = p.discount_type === "percent" ? (base * val) / 100 : val;
  return { effective: Math.max(0, base - off), discounted: true };
}
function escapeLike(s: string): string { return s.replace(/[%_]/g, (m) => `\${m}`); }
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ─── Bot pause flags (migration 0014) ────────────────────────────────────────────────────────
// Each fetch caches 30s. Missing column or row → treat as enabled (back-
// compat with rows created before the migration).

async function isGlobalBotEnabled(admin: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (globalBotCache && globalBotCache.expires > now) return globalBotCache.enabled;
  let enabled = true;
  try {
    const { data } = await admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle();
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { /* assume enabled on error */ }
  globalBotCache = { enabled, expires: now + BOT_FLAG_CACHE_TTL_MS };
  return enabled;
}

async function isChannelBotEnabled(admin: SupabaseClient, channel: string): Promise<boolean> {
  const now = Date.now();
  const cached = channelBotCache.get(channel);
  if (cached && cached.expires > now) return cached.enabled;
  let enabled = true;
  try {
    const { data } = await admin.from("ai_personas").select("bot_enabled").eq("channel", channel).maybeSingle();
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { /* assume enabled */ }
  channelBotCache.set(channel, { enabled, expires: now + BOT_FLAG_CACHE_TTL_MS });
  return enabled;
}

async function isConversationBotEnabled(admin: SupabaseClient, convId: string): Promise<boolean> {
  const now = Date.now();
  const cached = convBotCache.get(convId);
  if (cached && cached.expires > now) return cached.enabled;
  let enabled = true;
  try {
    const { data } = await admin.from("chat_conversations").select("bot_enabled").eq("id", convId).maybeSingle();
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { /* assume enabled */ }
  convBotCache.set(convId, { enabled, expires: now + BOT_FLAG_CACHE_TTL_MS });
  return enabled;
}

async function getKeywordRewritePairs(admin: SupabaseClient): Promise<RewritePair[]> {
  const now = Date.now();
  if (keywordCache && keywordCache.expires > now) return keywordCache.pairs;
  const { data } = await admin
    .from("keyword_synonyms")
    .select("canonical, aliases")
    .eq("is_active", true);
  const rows = ((data ?? []) as KeywordRow[]).filter(
    (r) => typeof r.canonical === "string" && Array.isArray(r.aliases),
  );
  const pairs: RewritePair[] = [];
  for (const r of rows) {
    for (const a of r.aliases) {
      if (typeof a === "string" && a.trim()) {
        pairs.push({ alias: a.trim(), canonical: r.canonical.trim() });
      }
    }
  }
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  keywordCache = { pairs, expires: now + KEYWORD_CACHE_TTL_MS };
  return pairs;
}

async function rewriteWithKeywords(
  admin: SupabaseClient,
  query: string,
): Promise<{ rewritten: string; applied: RewritePair[] }> {
  const pairs = await getKeywordRewritePairs(admin);
  if (pairs.length === 0) return { rewritten: query, applied: [] };
  let result = query;
  const applied: RewritePair[] = [];
  for (const p of pairs) {
    const re = new RegExp(escapeRegex(p.alias), "gi");
    if (re.test(result)) {
      result = result.replace(re, p.canonical);
      applied.push(p);
    }
  }
  return { rewritten: result, applied };
}

async function findProducts(admin: SupabaseClient, query: string) {
  const original = (query ?? "").trim();
  if (!original) return { products: [], note: "empty query" };

  const { rewritten, applied } = await rewriteWithKeywords(admin, original);
  const q = rewritten;

  const rawTokens = q.split(/\s+/).filter(Boolean).slice(0, 12);
  if (rawTokens.length === 0) return { products: [], note: "empty query" };
  const tokens = stripStopWords(rawTokens).slice(0, 8);

  let qb = admin.from("products").select(`${PRODUCT_COLUMNS_CUSTOMER}, category:categories(name_th, name_en), group:product_groups(name), inventory(quantity, reorder_level)`).eq("status", "active");
  for (const tok of tokens) {
    const pat = `%${escapeLike(tok)}%`;
    qb = qb.or(`sku.ilike.${pat},name_th.ilike.${pat},name_en.ilike.${pat},brand.ilike.${pat}`);
  }
  qb = qb.limit(25);
  const { data, error } = await qb;
  if (error) return { error: error.message };

  if ((data ?? []).length > 0) {
    return {
      query: q, original_query: original !== q ? original : undefined,
      synonym_rewrites: applied.length > 0 ? applied : undefined,
      tokens,
      stripped: rawTokens.length !== tokens.length ? rawTokens.filter((t) => !tokens.includes(t)) : [],
      count: (data ?? []).length,
      products: (data ?? []).map((p: Record<string, unknown>) => formatProductForLLM(p)),
    };
  }

  try {
    const { data: fuzzy } = await admin.rpc("search_products_fuzzy", {
      p_query: q, p_limit: 3, p_threshold: 0.2,
    }) as { data: Array<{ product_id: string; sku: string; name_th: string; name_en: string; sim: number }> | null };
    if (fuzzy && fuzzy.length > 0) {
      return {
        query: q, original_query: original !== q ? original : undefined,
        synonym_rewrites: applied.length > 0 ? applied : undefined,
        tokens, count: 0, products: [],
        clarification_candidates: fuzzy.map((r) => ({ sku: r.sku, name_th: r.name_th, name_en: r.name_en ?? null })),
        note: "มีสินค้าชื่อใกล้เคียงในระบบ ห้ามใช้คำว่า 'ไม่พบ' หรือ 'ไม่มี' เด็ดขาด — ให้แนะนำสินค้าใกล้เคียงเหล่านี้ให้ลูกค้าเลือก แล้วถามว่าสนใจตัวไหน ถ้าลูกค้ายืนยันว่าต้องการตัวที่พิมพ์มาเป๊ะ ให้เสนอสั่งผลิตและส่งให้คุณเชอร์รี่เช็คเวลาผลิต",
      };
    }
  } catch (_e) { /* fuzzy unavailable */ }

  return {
    query: q, original_query: original !== q ? original : undefined,
    synonym_rewrites: applied.length > 0 ? applied : undefined,
    tokens,
    stripped: rawTokens.length !== tokens.length ? rawTokens.filter((t) => !tokens.includes(t)) : [],
    count: 0, products: [],
    note: "ค้นแล้วยังไม่เจอสินค้าที่ตรง และไม่มีตัวใกล้เคียง — ห้ามตอบว่า 'ไม่พบ/ไม่มี' ให้บอกว่าจะส่งให้คุณเชอร์รี่ตรวจสอบว่าสั่งผลิตหรือจัดหาให้ได้ไหม แล้วแจ้งกลับ",
  };
}

async function getProductDetail(admin: SupabaseClient, sku: string) {
  const s = (sku ?? "").trim();
  if (!s) return { error: "empty sku" };
  const { data, error } = await admin.from("products").select(`${PRODUCT_COLUMNS_CUSTOMER}, description_th, description_en, spec, is_featured, category:categories(name_th, name_en), group:product_groups(name, description), inventory(quantity, reorder_level, shelf, row_no)`).eq("sku", s).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `SKU '${s}' not found` };
  return formatProductForLLM(data as Record<string, unknown>, true);
}

async function listProductGroups(admin: SupabaseClient) {
  const { data, error } = await admin.from("product_groups").select(`name, description, products(sku)`).order("name", { ascending: true });
  if (error) return { error: error.message };
  return { groups: (data ?? []).map((g: Record<string, unknown>) => ({ name: g.name, description: g.description, member_count: (g.products as unknown[] | null)?.length ?? 0 })) };
}

async function getGroupMembers(admin: SupabaseClient, groupName: string) {
  const n = (groupName ?? "").trim();
  if (!n) return { error: "empty group_name" };
  const pat = `%${escapeLike(n)}%`;
  const { data: groups, error: gErr } = await admin.from("product_groups").select("id, name, description").ilike("name", pat).limit(3);
  if (gErr) return { error: gErr.message };
  if (!groups || groups.length === 0) return { error: `Group '${n}' not found` };
  const exact = groups.find((g: Record<string, unknown>) => g.name === n);
  const target = exact ?? groups[0];
  const targetId = (target as Record<string, unknown>).id as string;
  const { data: members, error: mErr } = await admin.from("products").select(`${PRODUCT_COLUMNS_CUSTOMER}, category:categories(name_th, name_en), inventory(quantity)`).eq("group_id", targetId).eq("status", "active").order("name_th", { ascending: true });
  if (mErr) return { error: mErr.message };
  return { group: { name: target.name, description: target.description }, member_count: (members ?? []).length, members: (members ?? []).map((p: Record<string, unknown>) => formatProductForLLM(p)) };
}

async function listCategories(admin: SupabaseClient) {
  const { data, error } = await admin.from("categories").select("name_th, name_en, slug").eq("is_active", true).order("sort_order", { ascending: true });
  if (error) return { error: error.message };
  return { categories: data ?? [] };
}

function formatProductForLLM(p: Record<string, unknown>, detail = false) {
  const inv = (p.inventory as Array<{ quantity: number }> | null) ?? [];
  const stock = inv.reduce((acc, i) => acc + Number(i.quantity ?? 0), 0);
  const { effective, discounted } = computeEffectivePrice(p as { price: unknown; discount_value: unknown; discount_type: unknown });
  const imgs = Array.isArray(p.images) ? (p.images as string[]) : [];
  const base = {
    sku: p.sku, name_th: p.name_th, name_en: p.name_en, brand: p.brand,
    category: (p.category as { name_th?: string } | null)?.name_th ?? null,
    group: (p.group as { name?: string } | null)?.name ?? null,
    price: Number(p.price ?? 0), discount_value: Number(p.discount_value ?? 0), discount_type: p.discount_type ?? null,
    effective_price: effective, discounted, unit: p.unit, stock, in_stock: stock > 0, status: p.status,
    min_order_qty: Math.max(1, Number(p.min_order_qty ?? 1)),
    image_thumb: imgs.length > 0 ? imgs[0] : null,
  };
  if (!detail) return base;
  return { ...base, description_th: p.description_th, description_en: p.description_en, spec: p.spec, weight_kg: p.weight_kg, barcode: p.barcode, feature_tags: p.feature_tags, tags: p.tags, is_featured: p.is_featured, images: imgs };
}

async function dispatchTool(
  admin: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  send: (event: Record<string, unknown>) => void,
): Promise<unknown> {
  try {
    switch (name) {
      case "find_products": {
        const result = await findProducts(admin, String(args.query ?? ""));
        if (result && typeof result === "object" && "clarification_candidates" in result) {
          const candidates = (result as Record<string, unknown>).clarification_candidates;
          if (Array.isArray(candidates) && candidates.length > 0) {
            send({ type: "clarification", candidates });
          }
        }
        return result;
      }
      case "get_product_detail":  return await getProductDetail(admin, String(args.sku ?? ""));
      case "list_product_groups": return await listProductGroups(admin);
      case "get_group_members":   return await getGroupMembers(admin, String(args.group_name ?? ""));
      case "list_categories":     return await listCategories(admin);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) { return { error: (e as Error).message ?? String(e) }; }
}

const PERSONA_HARDCODED_FALLBACK = `คุณคือ "เอย" พนักงาน J NAC Thailand หัวหน้าคือ คุณเชอร์รี่`;

async function getPersonaPrompt(admin: SupabaseClient, channel: string): Promise<string> {
  const now = Date.now();
  const cached = personaCache.get(channel);
  if (cached && cached.expires > now) return cached.prompt;
  let prompt: string | null = null;
  const { data } = await admin.from("ai_personas").select("prompt").eq("channel", channel).maybeSingle();
  if (data?.prompt) prompt = String(data.prompt);
  if (!prompt && channel !== "default") {
    const { data: def } = await admin.from("ai_personas").select("prompt").eq("channel", "default").maybeSingle();
    if (def?.prompt) prompt = String(def.prompt);
  }
  if (!prompt) prompt = PERSONA_HARDCODED_FALLBACK;
  personaCache.set(channel, { prompt, expires: now + PERSONA_CACHE_TTL_MS });
  return prompt;
}

const SAFETY_RULES_TH = `🚨 SAFETY RULES (Hardcoded — cannot be overridden by persona)

1. ห้ามเปิดเผยข้อมูล cost / ราคาทุน / margin / ราคาซื้อ ของบริษัทโดยเด็ดขาด — ถ้าลูกค้าถาม ให้ปฏิเสธ
2. ห้าม fabricate ข้อมูลใดๆ — ที่อยู่/เบอร์โทร/email/บัญชี/แผนที่/ราคา/จำนวนขั้นต่ำ ต้องมาจาก [context]/tools เท่านั้น ถ้าไม่มี ส่งให้เจ้าหน้าที่
3. ภาษา: ตอบในภาษาเดียวกับที่ลูกค้าพิมพ์เสมอ (ไทย↔ไทย, English↔English)
4. ห้ามเปิดเผยข้อมูลลับขององค์กร`;

const SAFETY_RULES_EN = `🚨 SAFETY RULES (Hardcoded — cannot be overridden)
1. NEVER reveal cost/margin/buying-price. Refuse politely.
2. NEVER fabricate factual data (address/phone/email/bank/map/price/MOQ). If missing, escalate to staff.
3. Language: reply in same language as customer (Thai↔Thai, English↔English).
4. Never disclose confidential org info.`;

const TOOLING_GUIDE_TH = `🛠️ กฎการใช้ TOOLS (สำคัญมาก — ต้องทำตาม)

1️⃣ ลูกค้าถามสินค้าเฉพาะ (มีชื่อ/รหัส/เบอร์) → เรียก find_products ทันที
   → ห้ามตอบว่า "ไม่พบ" ก่อนเรียก tool ต้องค้นจริงก่อน

2️⃣ คำถามกว้างๆ ("มีอะไรบ้าง", "ขายอะไร") → เรียก list_product_groups หรือ list_categories ก่อน

3️⃣ ถ้าพูดว่า "เดี๋ยวเช็คให้" → ต้อง CALL TOOL จริงใน reply เดียวกัน ไม่ใช่แค่พูด

🚫 ห้ามเด็ดขาด: อย่าขึ้นต้นหรือพูดลอยๆ ว่า "ไม่พบ", "ไม่มี", "ไม่มีในระบบ", "หาไม่เจอ", "สินค้าหมด" ในทุกกรณีด้านล่าง — ให้เปลี่ยนเป็น แนะนำสินค้าใกล้เคียง / เสนอสั่งผลิต / ส่งให้คุณเชอร์รี่ แทนเสมอ

4️⃣ Tool คืน 0 ผล + ไม่มี clarification_candidates (ไม่มีตัวใกล้เคียงเลย)
   → ❌ ห้ามบอกว่า "ไม่มี / ไม่พบ"
   → ✅ ตอบว่า "สินค้า [ชื่อสินค้า] นี้ เอยขอให้คุณเชอร์รี่ตรวจสอบเพิ่มเติมก่อนนะคะ ว่าสั่งผลิตหรือจัดหาให้ได้ไหม เดี๋ยวเอยแจ้งกลับอีกทีนะคะ 😊"

5️⃣ Tool คืน clarification_candidates หรือเจอสินค้ารุ่น/ขนาดใกล้เคียง (ไม่ตรงเป๊ะ)
   → ❌ ห้ามขึ้นต้นด้วย "ไม่พบ / ไม่มี" เด็ดขาด
   → ✅ แนะนำสินค้าใกล้เคียงที่เจอ "เสมอ" เช่น "เอยมีรุ่นใกล้เคียงให้เลือกค่ะ ✨" แล้วลิสต์ชื่อทุกตัว
   → ถามว่าลูกค้าสนใจตัวไหน เช่น "สนใจตัวไหนไหมคะ?"
   → ถ้าลูกค้ายืนยันว่าต้องการตัวที่พิมพ์มาเป๊ะ (ที่ไม่มีในลิสต์) → เสนอสั่งผลิต + ส่งให้คุณเชอร์รี่เช็คเวลาผลิต

6️⃣ เจอสินค้าแต่ in_stock = false / stock = 0 (สินค้าหมดสต็อก)
   → ❌ ห้ามตอบแค่ "หมดค่ะ"
   → ✅ เสนอสั่งผลิตเสมอ: "ตอนนี้ [ชื่อสินค้า] หมดสต็อกอยู่ค่ะ 😔 แต่เอยสั่งผลิตให้ได้นะคะ ✨ เดี๋ยวขอเช็คเวลาผลิตกับคุณเชอร์รี่ก่อนนะคะ"

7️⃣ query: ใส่เฉพาะตัวระบุสินค้า (ชื่อ/SKU/ขนาด) — อย่าใส่คำสุภาพ/คำถาม

📦 ช่องข้อมูลจาก tool (ใช้ตอนตอบลูกค้า)
• stock = จำนวนในสต็อก (0 = สินค้าหมด)
• in_stock = true/false
• min_order_qty = จำนวนขั้นต่ำในการสั่งซื้อ — ใช้ค่านี้เสมอ อย่าเดาจาก description!
• unit = หน่วยนับ (ไปคู่กับ min_order_qty)

🧠 อ่านบริบท / HISTORY
• ดูประวัติสนทนา — ทักทายไปแล้ว ห้ามทักซ้ำ
• ลูกค้าขอบคุณ/ลา → ตอบสั้นๆ ปิดบทสนทนา
• "อันนั้น" = สินค้าที่เพิ่งคุย

📖 อ่าน [context]
• ![alt](url) → คัดลอก verbatim
• links → ใส่ในคำตอบ

🖼️ รูปสินค้า: ใช้ image_thumb เป็น ![ชื่อ SKU](url)`;

const TOOLING_GUIDE_EN = `🛠️ TOOLING RULES (CRITICAL)

1️⃣ Specific product (name/model/SKU) → call find_products FIRST. Never say "not available" before calling.
2️⃣ Broad question ("what do you have") → call list_product_groups / list_categories first.
3️⃣ If you say "let me check" → you MUST call a tool in the SAME reply.

🚫 NEVER open with or bluntly say "not found / not available / we don't have it / out of stock" in any case below — always pivot to suggesting similar items / made-to-order / forwarding to Khun Cherry.

4️⃣ Tool returns 0 results + no clarification_candidates (no close matches)
   → Don't say "not found". Say: "Let me have Khun Cherry check whether we can make-to-order or source [product] — I'll get back to you 😊"
5️⃣ Tool returns clarification_candidates / close-but-not-exact matches
   → ❌ Never open with "not found".
   → ✅ ALWAYS recommend the similar items found ("I have similar options ✨"), list them all, ask which they want.
   → If the customer confirms the exact item they typed (not in the list) → offer made-to-order + forward to Khun Cherry for lead time.
6️⃣ Found but in_stock = false / stock = 0 → never just "out of stock". Offer made-to-order: "It's out of stock now, but I can make it to order — let me check the lead time with Khun Cherry."
7️⃣ query: pass ONLY product identifier. Skip politeness/intent words.

📦 Tool fields:
• stock = qty in stock (0 = out of stock)
• in_stock = boolean
• min_order_qty = MOQ — ALWAYS use this for the MOQ line, never guess from description
• unit = goes with min_order_qty

🧠 Read history: don't greet twice. "that one" = product just discussed.
📖 Context ![alt](url) → copy verbatim.
🖼️ Product images: image_thumb as ![name SKU](url)`;

function buildSystemPrompt(persona: string, contextText: string | null, lang: Lang): string {
  const safety  = lang === "th" ? SAFETY_RULES_TH  : SAFETY_RULES_EN;
  const tooling = lang === "th" ? TOOLING_GUIDE_TH : TOOLING_GUIDE_EN;
  const ctx = contextText ? `\n\n[knowledge base context]\n${contextText}` : "";
  return `${safety}

══════════════════════════════════════════════════
👤 PERSONA (configurable per-channel via Settings → AI Persona)
══════════════════════════════════════════════════
${persona}

══════════════════════════════════════════════════
${tooling}${ctx}`;
}

interface GeminiStreamResult { fullText: string; toolCalls: Array<{ name: string; args: Record<string, unknown> }>; allParts: unknown[]; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; model: string; }

async function streamGeminiOnce(apiKey: string, model: string, systemPrompt: string, contents: unknown[], onText: (chunk: string) => void): Promise<GeminiStreamResult> {
  const res = await fetch(`${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] }, contents, tools: TOOL_DEFINITIONS,
      generationConfig: { temperature: 0, maxOutputTokens: 1024, topP: 0.95 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    }),
  });
  if (!res.ok) { const errText = await res.text(); throw new Error(`Gemini ${res.status} (${model}): ${errText.slice(0, 500)}`); }
  if (!res.body) throw new Error(`Gemini empty body (${model})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ""; let fullText = "";
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const allParts: unknown[] = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1 || (idx = buffer.indexOf("\r\n\r\n")) !== -1) {
      const sep = buffer.substring(idx, idx + 4) === "\r\n\r\n" ? 4 : 2;
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + sep);
      const lines = event.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(line[5] === " " ? 6 : 5);
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          const parts = data?.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (typeof part.text === "string" && part.text) { fullText += part.text; onText(part.text); }
            if (part.functionCall) { toolCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} }); }
            allParts.push(part);
          }
          const u = data?.usageMetadata;
          if (u) {
            usage.prompt_tokens = Number(u.promptTokenCount ?? usage.prompt_tokens);
            usage.completion_tokens = Number(u.candidatesTokenCount ?? usage.completion_tokens);
            usage.total_tokens = Number(u.totalTokenCount ?? usage.total_tokens);
          }
        } catch (_e) { /* skip */ }
      }
    }
  }
  return { fullText, toolCalls, allParts, usage, model };
}

async function streamGeminiWithFallback(apiKey: string, systemPrompt: string, contents: unknown[], onText: (chunk: string) => void): Promise<GeminiStreamResult> {
  let lastErr: Error | null = null;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < RETRY_PER_MODEL; attempt++) {
      try { return await streamGeminiOnce(apiKey, model, systemPrompt, contents, onText); }
      catch (e) {
        lastErr = e as Error;
        const msg = (e as Error).message ?? "";
        const transient = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("429");
        if (!transient) break;
        await new Promise((r) => setTimeout(r, 400 + attempt * 800));
      }
    }
  }
  throw lastErr ?? new Error("Gemini all models failed");
}

async function getGeminiKey(admin: SupabaseClient): Promise<string | null> {
  if (cachedGeminiKey) return cachedGeminiKey;
  const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: "GEMINI_API_KEY" });
  if (error) { console.warn("GEMINI_API_KEY read failed:", error.message); return null; }
  cachedGeminiKey = (data as string | null) ?? null;
  return cachedGeminiKey;
}
async function getOpenAIKey(admin: SupabaseClient): Promise<string | null> {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: "OPENAI_API_KEY" });
  if (error) { console.warn("OPENAI_API_KEY read failed:", error.message); return null; }
  cachedOpenAIKey = (data as string | null) ?? null;
  return cachedOpenAIKey;
}
async function embedQueryOpenAI(apiKey: string, query: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: query, model: OPENAI_EMBED_MODEL }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI embed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return (data?.data?.[0]?.embedding ?? []) as number[];
}

async function upsertLivechatConversation(admin: SupabaseClient, sessionId: string, displayName: string): Promise<string | null> {
  const { data: existing, error: selErr } = await admin.from("chat_conversations").select("id").eq("channel", "livechat").eq("external_id", sessionId).maybeSingle();
  if (selErr) { console.warn("livechat conv select failed:", selErr.message); return null; }
  if (existing?.id) return existing.id as string;
  const { data: inserted, error: insErr } = await admin.from("chat_conversations").insert({
    channel: "livechat", external_id: sessionId, display_name: displayName || `Visitor #${sessionId.slice(0, 6)}`, status: "open",
  }).select("id").single();
  if (insErr) { console.warn("livechat conv insert failed:", insErr.message); return null; }
  return (inserted as { id: string }).id;
}

async function saveMessage(admin: SupabaseClient, conversationId: string, senderType: "customer" | "agent" | "bot" | "system", content: string, metadata: Record<string, unknown> = {}) {
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: senderType, content, content_type: "text", metadata,
  });
  if (error) { console.warn("chat msg insert failed:", error.message); return; }
  const preview = content.slice(0, 140);
  await admin.from("chat_conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: preview,
  }).eq("id", conversationId);
}

function zeroTokens() { return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; }
function zeroElapsed() { return { embed: 0, search: 0, llm: 0 }; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: MSG.th.invalidJson + " / " + MSG.en.invalidJson }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const query = String(body.query ?? "").trim();
  const history = (body.history ?? []) as Array<{ role: string; content: string }>;
  const match_count = Number(body.match_count ?? DEFAULT_MATCH_COUNT);
  const matchThreshold = Number(body.match_threshold ?? DEFAULT_MATCH_THRESHOLD);
  const wantStream = body.stream !== false;
  const lang: Lang = detectLanguage(query);
  const sessionId = typeof body.session_id === "string" && body.session_id.length >= 8 ? body.session_id : null;
  const displayName = typeof body.display_name === "string" ? body.display_name : "";
  const channelRaw = typeof body.channel === "string" ? body.channel.toLowerCase() : "default";
  const channel = ALLOWED_CHANNELS.has(channelRaw) ? channelRaw : "default";

  if (!query) return new Response(JSON.stringify({ error: MSG[lang].queryRequired }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  let conversationId: string | null = null;
  if (sessionId) conversationId = await upsertLivechatConversation(admin, sessionId, displayName);
  if (conversationId) await saveMessage(admin, conversationId, "customer", query, { lang });

  if (wantStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: Record<string, unknown>) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch (_e) { /* closed */ }
        };
        try { await handleQuery(admin, query, history, match_count, matchThreshold, lang, channel, conversationId, send); }
        catch (e) {
          const msg = (e as Error).message ?? String(e);
          const friendly = /503|UNAVAILABLE|429/.test(msg) ? MSG[lang].aiBusy : msg;
          send({ type: "error", message: friendly });
        } finally { try { controller.close(); } catch (_e) { /* ignore */ } }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive", ...CORS_HEADERS } });
  }

  const events: Array<Record<string, unknown>> = [];
  try { await handleQuery(admin, query, history, match_count, matchThreshold, lang, channel, conversationId, (e) => events.push(e)); }
  catch (e) {
    const msg = (e as Error).message ?? String(e);
    const friendly = /503|UNAVAILABLE|429/.test(msg) ? MSG[lang].aiBusy : msg;
    events.push({ type: "error", message: friendly });
  }
  const done = events.find((e) => e.type === "done") ?? {};
  const errEv = events.find((e) => e.type === "error");
  const fullText = events.filter((e) => e.type === "text").map((e) => String(e.chunk ?? "")).join("");
  const blockedAnswer = events.find((e) => e.type === "blocked");
  const pausedEv = events.find((e) => e.type === "paused");
  const answer = (blockedAnswer?.answer as string | undefined) ?? fullText ?? "";

  const clarificationEv = events.find((e) => e.type === "clarification");
  const clarification_candidates = clarificationEv
    ? (clarificationEv as Record<string, unknown>).candidates
    : undefined;

  return new Response(JSON.stringify({
    answer, sources: (done as Record<string, unknown>).sources ?? [],
    tokens: (done as Record<string, unknown>).tokens ?? zeroTokens(),
    elapsed_ms: (done as Record<string, unknown>).elapsed_ms ?? zeroElapsed(),
    model: (done as Record<string, unknown>).model ?? "unknown",
    tool_calls: (done as Record<string, unknown>).tool_calls ?? [],
    conversation_id: conversationId,
    channel,
    clarification_candidates,
    paused: pausedEv ? (pausedEv as Record<string, unknown>).reason : undefined,
    blocked: blockedAnswer ? "cost_query" : undefined,
    error: errEv ? (errEv.message as string) : undefined,
  }), { status: errEv ? 500 : 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
});

async function handleQuery(admin: SupabaseClient, query: string, history: Array<{ role: string; content: string }>, match_count: number, matchThreshold: number, lang: Lang, channel: string, conversationId: string | null, send: (event: Record<string, unknown>) => void) {
  // ─── Bot pause guard (3-level) ─────────────────────────────────────────────────────────
  // Customer message has already been saved in chat_messages above. Just
  // skip the LLM call (and any cost) when any flag is off. Widget filters
  // its placeholder bubble out on the `paused` event.
  const [globalOn, channelOn, convOn] = await Promise.all([
    isGlobalBotEnabled(admin),
    isChannelBotEnabled(admin, channel),
    conversationId ? isConversationBotEnabled(admin, conversationId) : Promise.resolve(true),
  ]);
  if (!globalOn || !channelOn || !convOn) {
    const reason = !globalOn ? "global" : !channelOn ? "channel" : "conversation";
    send({ type: "paused", reason });
    send({ type: "done", sources: [], tokens: zeroTokens(), elapsed_ms: zeroElapsed(), model: `paused:${reason}`, tool_calls: [], conversation_id: conversationId, channel });
    return;
  }

  if (isCostQuery(query)) {
    const refusal = MSG[lang].costRefusal;
    send({ type: "blocked", reason: "cost_query", answer: refusal });
    send({ type: "text", chunk: refusal });
    send({ type: "done", sources: [], tokens: zeroTokens(), elapsed_ms: zeroElapsed(), model: "guardrail", tool_calls: [], conversation_id: conversationId, channel });
    if (conversationId) await saveMessage(admin, conversationId, "bot", refusal, { blocked: "cost_query" });
    return;
  }

  const [geminiKey, openaiKey, persona] = await Promise.all([
    getGeminiKey(admin), getOpenAIKey(admin), getPersonaPrompt(admin, channel),
  ]);
  if (!geminiKey) throw new Error(MSG[lang].geminiKeyMissing);
  if (!openaiKey) throw new Error(MSG[lang].openaiKeyMissing);

  send({ type: "status", message: "thinking", channel });
  let embed_ms = 0;
  let search_ms = 0;
  let matchedRows: Array<{ id: string; content: string; metadata: unknown; similarity: number; source_path: string; tags: string[]; title: string | null }> = [];
  let expandedRows: Array<{ source_path: string; chunk_index: number; title: string | null; content: string }> = [];
  let contextText: string | null = null;

  if (!shouldSkipRAG(query)) {
    const t0 = Date.now();
    const queryEmbedding = await embedQueryOpenAI(openaiKey, query);
    embed_ms = Date.now() - t0;
    const t1 = Date.now();
    const { data: matches, error: matchErr } = await admin.rpc("match_knowledge", {
      query_embedding: JSON.stringify(queryEmbedding), match_threshold: matchThreshold, match_count, filter_language: lang, filter_visibility: "public",
    });
    if (matchErr) throw matchErr;
    matchedRows = (matches ?? []) as typeof matchedRows;
    const sourcePaths = [...new Set(matchedRows.map((m) => m.source_path))];
    if (sourcePaths.length > 0) {
      const { data: all, error: allErr } = await admin
        .from("knowledge_chunks").select("source_path, chunk_index, title, content")
        .in("source_path", sourcePaths).eq("visibility", "public")
        .order("source_path", { ascending: true }).order("chunk_index", { ascending: true });
      if (allErr) throw allErr;
      expandedRows = ((all ?? []) as typeof expandedRows).slice(0, MAX_CONTEXT_CHUNKS);
    }
    search_ms = Date.now() - t1;
    if (expandedRows.length > 0) {
      const bySource = new Map<string, typeof expandedRows>();
      for (const r of expandedRows) {
        const arr = bySource.get(r.source_path) ?? [];
        arr.push(r); bySource.set(r.source_path, arr);
      }
      const blocks: string[] = [];
      let i = 1;
      for (const [sp, rows] of bySource) {
        const title = rows[0]?.title ? " — " + rows[0].title : "";
        const body = rows.map((r) => r.content).join("\n\n");
        blocks.push(`[ที่มา ${i}: ${sp}${title}]\n${body}`); i++;
      }
      contextText = blocks.join("\n\n---\n\n");
    }
  } else {
    send({ type: "status", message: "rag_skipped_product_query" });
  }

  const systemPrompt = buildSystemPrompt(persona, contextText, lang);
  const t2 = Date.now();
  const contents: unknown[] = [
    ...history.map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] })),
    { role: "user", parts: [{ text: query }] },
  ];
  const usage = zeroTokens();
  const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result_summary?: string }> = [];
  let usedModel = GEMINI_MODELS[0];
  let fullAnswer = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const r = await streamGeminiWithFallback(geminiKey, systemPrompt, contents, (chunk) => {
      fullAnswer += chunk;
      send({ type: "text", chunk });
    });
    usedModel = r.model;
    usage.prompt_tokens += r.usage.prompt_tokens;
    usage.completion_tokens += r.usage.completion_tokens;
    usage.total_tokens += r.usage.total_tokens;
    if (r.toolCalls.length === 0) break;
    contents.push({ role: "model", parts: r.allParts });
    for (const tc of r.toolCalls) { send({ type: "tool_call", name: tc.name, args: tc.args }); }
    const responseParts = await Promise.all(
      r.toolCalls.map(async (call) => {
        const result = await dispatchTool(admin, call.name, call.args, send);
        allToolCalls.push({ name: call.name, args: call.args, result_summary: JSON.stringify(result).slice(0, 200) });
        return { functionResponse: { name: call.name, response: result } };
      }),
    );
    contents.push({ role: "user", parts: responseParts });
    if (iter === MAX_TOOL_ITERATIONS - 1) {
      const msgText = MSG[lang].maxIterations;
      fullAnswer += msgText;
      send({ type: "text", chunk: msgText });
    }
  }

  const llm_ms = Date.now() - t2;
  const sources = matchedRows.map((m) => ({ id: m.id, title: m.title, source_path: m.source_path, similarity: m.similarity, tags: m.tags ?? [], content_preview: m.content.slice(0, 200) }));
  if (conversationId && fullAnswer.trim()) {
    await saveMessage(admin, conversationId, "bot", fullAnswer, {
      model: usedModel, channel,
      tool_calls: allToolCalls.map((t) => ({ name: t.name, args: t.args })),
      tokens: usage,
    });
  }
  send({ type: "done", sources, tokens: usage, elapsed_ms: { embed: embed_ms, search: search_ms, llm: llm_ms }, model: usedModel, tool_calls: allToolCalls, conversation_id: conversationId, channel });
}
