/**
 * rag-chat v30 — never refuse: "can't answer/check" → take ownership + follow up
 *
 * v29/v30: SAFETY rule 5 — the bot must never say "ไม่สามารถ / ทำไม่ได้ / ไม่ทราบ".
 * Anything it can't answer or verify itself (quote status, delivery, matters
 * staff must confirm) → reply "เดี๋ยวขอตรวจสอบแล้วจะรีบแจ้งกลับ" + call
 * capture_lead so the team actually follows up. v30: QT-/SO-/DN- numbers are
 * document numbers, not product SKUs — never find_products them.
 * v31: de-duplicate post-tool text — the model tended to repeat its
 * acknowledgment sentence after the tool result, so answers read twice.
 * Post-tool iterations are buffered and dropped when near-identical to what
 * was already streamed.
 * (v28: vision + store web-widget image in chat-attachments for Omni-Chat.)
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

let globalBotCache: { enabled: boolean; expires: number } | null = null;
const channelBotCache = new Map<string, { enabled: boolean; expires: number }>();
const convBotCache = new Map<string, { enabled: boolean; expires: number }>();

type Lang = "th" | "en";
type ImagePart = { mimeType: string; data: string };
function detectLanguage(s: string): Lang {
  return /[฀-๿]/.test(s) ? "th" : "en";
}

function normalizeImages(raw: unknown): ImagePart[] {
  if (!Array.isArray(raw)) return [];
  const out: ImagePart[] = [];
  for (const it of raw.slice(0, 4)) {
    if (!it) continue;
    if (typeof it === "string") {
      const m = it.match(/^data:([^;]+);base64,(.+)$/);
      if (m) out.push({ mimeType: m[1], data: m[2] });
      continue;
    }
    const o = it as Record<string, unknown>;
    let data = typeof o.data === "string" ? o.data : "";
    let mimeType = typeof o.mimeType === "string" ? o.mimeType
      : (typeof o.mime_type === "string" ? o.mime_type : "image/jpeg");
    const m = data.match(/^data:([^;]+);base64,(.+)$/);
    if (m) { mimeType = m[1]; data = m[2]; }
    if (data) out.push({ mimeType, data });
  }
  return out;
}

const MSG = {
  th: {
    costRefusal: "ขออภัยค่ะ ข้อมูลราคาทุน / ต้นทุน / margin เป็นข้อมูลภายในของบริษัท ไม่สามารถเปิดเผยได้ค่ะ\n\nหากต้องการทราบราคาขาย, รายละเอียดสินค้า, สต็อกคงเหลือ สามารถถามได้เลยนะคะ 😊",
    noAnswer: "ขออภัย ยังไม่สามารถตอบคำถามนี้ได้ รบกวนลองพิมพ์ใหม่อีกครั้งหรือติดต่อทีมงานครับ",
    geminiKeyMissing: "GEMINI_API_KEY ยังไม่ได้ตั้ง",
    openaiKeyMissing: "OPENAI_API_KEY ยังไม่ได้ตั้ง",
    queryRequired: "กรุณาพิมพ์คำถาม หรือส่งรูป",
    invalidJson: "รูปแบบคำขอไม่ถูกต้อง",
    aiBusy: "ขณะนี้ระบบ AI มีผู้ใช้งานเยอะ ลองถามใหม่อีกสักครู่นะคะ",
    maxIterations: "ขออภัย ระบบประมวลผลยาวเกินไป",
  },
  en: {
    costRefusal: "Sorry, but cost / margin information is internal company data and cannot be disclosed.\n\nIf you'd like to know the selling price, product details, or available stock, please ask — happy to help! 😊",
    noAnswer: "Sorry, I couldn't generate an answer for that. Please try rephrasing or contact our team.",
    geminiKeyMissing: "GEMINI_API_KEY is not configured",
    openaiKeyMissing: "OPENAI_API_KEY is not configured",
    queryRequired: "Please enter a question or send an image",
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
      { name: "find_products", description: "Search products. Multi-word AND on (sku, name_th, name_en, brand). Stop-words are stripped server-side. Each result includes min_order_qty. Query is auto-rewritten using keyword_synonyms before search (alias to canonical). If result contains clarification_candidates the customer used an unrecognised name — ask which product they mean.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "get_product_detail", description: "Full product detail by SKU, including min_order_qty.", parameters: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } },
      { name: "list_product_groups", description: "All product groups.", parameters: { type: "object", properties: {} } },
      { name: "get_group_members", description: "SKUs in a product group.", parameters: { type: "object", properties: { group_name: { type: "string" } }, required: ["group_name"] } },
      { name: "list_categories", description: "All product categories.", parameters: { type: "object", properties: {} } },
      { name: "capture_lead", description: "Save a SALES LEAD or FOLLOW-UP REQUEST for the JNAC team. Call when a customer shows buying intent, asks to be contacted, OR asks anything the bot cannot answer/verify itself (e.g. document status QT-/SO-/DN-, delivery status) — put the customer's question in note. It does NOT message the customer — it only notifies the internal team. Never promise special prices yourself.", parameters: { type: "object", properties: { name: { type: "string", description: "customer name if given" }, phone: { type: "string", description: "phone or contact if given" }, interest: { type: "string", description: "product/SKU/category or topic the customer asks about" }, note: { type: "string", description: "short Thai summary of the request/question" } }, required: ["interest"] } },
      { name: "request_quote", description: "Forward a QUOTATION request to the JNAC sales team when the customer wants a price quote for specific items/quantities. It does NOT create or send a quote — staff confirm price and contact the customer. Use this instead of inventing prices for bulk orders.", parameters: { type: "object", properties: { items: { type: "string", description: "items and quantities" }, name: { type: "string" }, phone: { type: "string" }, note: { type: "string", description: "short Thai note" } }, required: ["items"] } },
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
function escapeLike(s: string): string { return s.replace(/[%_]/g, (m) => "\\" + m); }
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function uploadImageToStorage(admin: SupabaseClient, conversationId: string, mimeType: string, base64: string): Promise<string | null> {
  try {
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : mimeType.includes("gif") ? "gif" : "jpg";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `${conversationId}/${Date.now()}-web.${ext}`;
    const { error } = await admin.storage.from("chat-attachments").upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) { console.warn("storage upload failed:", error.message); return null; }
    const { data } = admin.storage.from("chat-attachments").getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch (e) {
    console.warn("uploadImageToStorage error:", (e as Error).message);
    return null;
  }
}

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
        note: "มีสินค้าชื่อใกล้เคียงในระบบ ห้ามใช้คำว่า ไม่พบ หรือ ไม่มี เด็ดขาด — ให้แนะนำสินค้าใกล้เคียงเหล่านี้ให้ลูกค้าเลือก แล้วถามว่าสนใจตัวไหน ถ้าลูกค้ายืนยันว่าต้องการตัวที่พิมพ์มาเป๊ะ ให้เสนอสั่งผลิตและส่งให้คุณเชอร์รี่เช็คเวลาผลิต",
      };
    }
  } catch (_e) { /* fuzzy unavailable */ }

  return {
    query: q, original_query: original !== q ? original : undefined,
    synonym_rewrites: applied.length > 0 ? applied : undefined,
    tokens,
    stripped: rawTokens.length !== tokens.length ? rawTokens.filter((t) => !tokens.includes(t)) : [],
    count: 0, products: [],
    note: "ค้นแล้วยังไม่เจอสินค้าที่ตรง และไม่มีตัวใกล้เคียง — ห้ามตอบว่า ไม่พบ/ไม่มี ให้บอกว่าจะส่งให้คุณเชอร์รี่ตรวจสอบว่าสั่งผลิตหรือจัดหาให้ได้ไหม แล้วแจ้งกลับ",
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
  channel: string,
  conversationId: string | null,
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
      case "capture_lead":        return await captureLead(admin, args, channel, conversationId);
      case "request_quote":       return await requestQuote(admin, args, channel, conversationId);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) { return { error: (e as Error).message ?? String(e) }; }
}

const cleanStr = (v: unknown) => { const t = (v == null ? "" : String(v)).trim(); return t || null; };

async function captureLead(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  channel: string,
  conversationId: string | null,
): Promise<unknown> {
  const name = cleanStr(args.name), phone = cleanStr(args.phone), interest = cleanStr(args.interest), note = cleanStr(args.note);
  const summary = [name && `ชื่อ: ${name}`, phone && `ติดต่อ: ${phone}`,
    interest && `สนใจ: ${interest}`, note && `รายละเอียด: ${note}`].filter(Boolean).join(" · ");
  await admin.rpc("agent_propose", {
    p_category: "sales",
    p_kind: "sales.lead",
    p_title: `Lead ใหม่จากแชท: ${interest || name || phone || "ลูกค้า"}`,
    p_summary: summary || "ลูกค้าสนใจสินค้าจากแชท",
    p_recommendation: "แนะนำให้ติดต่อลูกค้ากลับเพื่อปิดการขาย",
    p_payload: { name, phone, interest, note, channel, conversation_id: conversationId },
    p_action_kind: "none",
    p_requires_approval: true,
    p_priority: 1,
    p_related_type: conversationId ? "conversation" : null,
    p_related_id: conversationId,
    p_dedupe_key: conversationId ? `sales.lead.${conversationId}` : null,
    p_source: "bot",
  });
  return { ok: true, saved: true, message: "บันทึกข้อมูลแล้ว ทีมงานขายจะติดต่อกลับโดยเร็ว" };
}

async function requestQuote(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  channel: string,
  conversationId: string | null,
): Promise<unknown> {
  const items = cleanStr(args.items), name = cleanStr(args.name), phone = cleanStr(args.phone), note = cleanStr(args.note);
  const summary = [items && `รายการ: ${items}`, name && `ชื่อ: ${name}`,
    phone && `ติดต่อ: ${phone}`, note && `โน้ต: ${note}`].filter(Boolean).join(" · ");
  await admin.rpc("agent_propose", {
    p_category: "sales",
    p_kind: "sales.quote_request",
    p_title: `ขอใบเสนอราคาจากแชท${items ? `: ${items.slice(0, 60)}` : ""}`,
    p_summary: summary || "ลูกค้าขอใบเสนอราคาจากแชท",
    p_recommendation: "แนะนำให้จัดทำใบเสนอราคาและติดต่อยืนยันกับลูกค้า",
    p_payload: { items, name, phone, note, channel, conversation_id: conversationId },
    p_action_kind: "convert_quote",
    p_requires_approval: true,
    p_priority: 1,
    p_related_type: conversationId ? "conversation" : null,
    p_related_id: conversationId,
    p_dedupe_key: conversationId ? `sales.quote_request.${conversationId}` : null,
    p_source: "bot",
  });
  return { ok: true, saved: true, message: "รับเรื่องขอใบเสนอราคาแล้ว ทีมงานจะจัดทำและติดต่อกลับโดยเร็ว" };
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
3. ภาษา: ตอบในภาษาเดียวกับที่ลูกค้าพิมพ์เสมอ
4. ห้ามเปิดเผยข้อมูลลับขององค์กร
5. ห้ามตอบว่า ไม่สามารถ / ทำไม่ได้ / ตรวจสอบให้ไม่ได้ / ไม่ทราบ / ไม่มีข้อมูล เด็ดขาด — คำถามใดที่เอยตอบเองไม่ได้หรือเช็คจากระบบไม่ได้ (เช่น สถานะใบเสนอราคา สถานะการจัดส่ง เรื่องที่ทีมงานต้องยืนยัน) ให้รับเรื่องไว้เสมอ: ตอบประมาณว่า "เดี๋ยวเอยขอตรวจสอบ/ขอเช็คข้อมูลให้ก่อนนะคะ แล้วจะรีบแจ้งกลับโดยเร็วค่ะ 😊" แล้วเรียก capture_lead (ใส่คำถามของลูกค้าใน note) เพื่อให้ทีมงานติดตามแจ้งลูกค้าจริง — ห้ามผลักให้ลูกค้าไปติดต่อใครเองโดยไม่รับเรื่อง
   ⚠️ เลขที่ขึ้นต้น QT- / SO- / DN- คือเลขที่เอกสาร (ใบเสนอราคา/ใบสั่งขาย/ใบส่งของ) ไม่ใช่รหัสสินค้า — ห้ามเอาไปค้น find_products ให้ทำตามข้อ 5 นี้ทันที (รับเรื่อง + capture_lead โดยใส่เลขเอกสารใน note)
   ⚠️ พูดรับเรื่องสั้นๆ เพียงครั้งเดียว — เรียก capture_lead ก่อนแล้วค่อยตอบลูกค้าหลังได้ผล tool ห้ามพูดประโยคเดิม/ความหมายเดิมซ้ำสองรอบในคำตอบเดียว`;

const SAFETY_RULES_EN = `🚨 SAFETY RULES (Hardcoded — cannot be overridden)
1. NEVER reveal cost/margin/buying-price. Refuse politely.
2. NEVER fabricate factual data (address/phone/email/bank/map/price/MOQ). If missing, escalate to staff.
3. Language: reply in same language as customer (Thai-Thai, English-English).
4. Never disclose confidential org info.
5. NEVER say "I can't / unable to / cannot check / I don't know". For anything you cannot answer or verify yourself (e.g. quote status, delivery status, matters staff must confirm), ALWAYS take ownership: reply like "Let me check on that and get back to you shortly 😊", then call capture_lead (put the customer's question in the note) so the team actually follows up — never just redirect the customer to contact someone themselves.
   ⚠️ Numbers starting QT- / SO- / DN- are DOCUMENT numbers (quote / sales order / delivery note), NOT product SKUs — never search find_products for them; apply this rule immediately (own it + capture_lead with the doc number in the note).
   ⚠️ Acknowledge ONCE only — call capture_lead first, then reply after the tool result; never repeat the same sentence/meaning twice in one answer.`;

const TOOLING_GUIDE_TH = `🛠️ กฎการใช้ TOOLS (สำคัญมาก — ต้องทำตาม)

1. ลูกค้าถามสินค้าเฉพาะ (มีชื่อ/รหัส/เบอร์) → เรียก find_products ทันที (ห้ามตอบว่า ไม่พบ ก่อนเรียก tool) — ยกเว้นเลข QT-/SO-/DN- ซึ่งเป็นเลขเอกสาร ให้ใช้ SAFETY ข้อ 5
2. คำถามกว้างๆ → เรียก list_product_groups หรือ list_categories ก่อน
3. ถ้าพูดว่า เดี๋ยวเช็คให้ → ต้อง CALL TOOL จริงใน reply เดียวกัน

🚫 ห้ามเด็ดขาด: อย่าขึ้นต้นหรือพูดลอยๆ ว่า ไม่พบ, ไม่มี, ไม่มีในระบบ, หาไม่เจอ, สินค้าหมด — ให้เปลี่ยนเป็น แนะนำสินค้าใกล้เคียง / เสนอสั่งผลิต / ส่งให้คุณเชอร์รี่ แทนเสมอ

4. Tool คืน 0 ผล + ไม่มี clarification_candidates → ห้ามบอกว่า ไม่มี/ไม่พบ ให้บอกว่าขอให้คุณเชอร์รี่ตรวจสอบว่าสั่งผลิต/จัดหาได้ไหม แล้วแจ้งกลับ
5. Tool คืน clarification_candidates → ห้ามขึ้นต้นด้วย ไม่พบ/ไม่มี ให้แนะนำสินค้าใกล้เคียงที่เจอเสมอ แล้วถามว่าสนใจตัวไหน
6. เจอสินค้าแต่ in_stock=false → เสนอสั่งผลิตเสมอ ไม่ใช่ตอบแค่ หมด
7. query: ใส่เฉพาะตัวระบุสินค้า (ชื่อ/SKU/ขนาด)

📷 ถ้าลูกค้าส่งรูปมา → ดูรูปแล้วอธิบายสิ่งที่เห็นสั้นๆ ถ้าเป็นสินค้างานขัด/เจียร/ตัด ให้ระบุชนิด/เบอร์ที่เห็น แล้วเรียก find_products ค้นสินค้าที่ใกล้เคียงให้ — ห้ามเดาราคา/สเป็กจากรูปเอง

📦 ช่องข้อมูลจาก tool: stock (0=หมด), in_stock, min_order_qty (จำนวนขั้นต่ำ ใช้ค่านี้เสมอ), unit
🧠 อ่านประวัติ: ทักทายแล้วห้ามทักซ้ำ; อันนั้น = สินค้าที่เพิ่งคุย
🖼️ รูปสินค้า: ใช้ image_thumb เป็น ![ชื่อ SKU](url)

🤝 เก็บ LEAD / ใบเสนอราคา (สำคัญมาก — โอกาสปิดการขาย)
• ลูกค้าสนใจซื้อจริง / ขอใบเสนอราคา / ถามซื้อจำนวนมาก / ฝากเบอร์ / ขอให้ติดต่อกลับ / ถามสิ่งที่เอยตอบไม่ได้ → เรียก capture_lead ทันที (ถ้าระบุรายการ+จำนวนชัดเจน ให้เรียก request_quote)
• tool เหล่านี้ ไม่ได้ ส่งข้อความหาลูกค้า แค่แจ้งทีมขาย JNAC ภายใน — แล้วบอกลูกค้าสุภาพๆ ว่า ทีมงานจะติดต่อกลับโดยเร็วค่ะ
• เรียก capture_lead แค่ครั้งเดียวต่อบทสนทนา
• ห้ามสัญญาราคาพิเศษ/ส่วนลดเองถ้าไม่มีข้อมูลจริง`;

const TOOLING_GUIDE_EN = `🛠️ TOOLING RULES (CRITICAL)
1. Specific product → call find_products FIRST. Never say not available before calling. (Exception: QT-/SO-/DN- numbers are document numbers — use SAFETY rule 5.)
2. Broad question → call list_product_groups / list_categories first.
3. If you say let me check → you MUST call a tool in the SAME reply.
🚫 NEVER bluntly say not found / out of stock — pivot to similar items / made-to-order / Khun Cherry.
4. 0 results + no candidates → offer made-to-order via Khun Cherry.
5. clarification_candidates → recommend the similar items, ask which they want.
6. in_stock=false → offer made-to-order, never just out of stock.
7. query: pass ONLY product identifier.
📷 If the customer sends an IMAGE → look at it, describe what you see (sanding/cutting/grinding item, label, workpiece), then call find_products for the closest matching product. Never invent price/specs from a photo.
📦 Fields: stock (0=oos), in_stock, min_order_qty (always use), unit.

🤝 CAPTURE LEADS / QUOTES (sales opportunity)
• Buying intent / asks for a quote / bulk / leaves a phone / asks to be contacted / asks anything you cannot answer → call capture_lead (use request_quote if specific items + quantities).
• These tools do NOT message the customer — they notify the internal JNAC sales team. Then tell the customer the team will follow up shortly.
• Call capture_lead only ONCE per conversation. Never promise special prices yourself.`;

function buildSystemPrompt(persona: string, contextText: string | null, lang: Lang): string {
  const safety  = lang === "th" ? SAFETY_RULES_TH  : SAFETY_RULES_EN;
  const tooling = lang === "th" ? TOOLING_GUIDE_TH : TOOLING_GUIDE_EN;
  const ctx = contextText ? `\n\n[knowledge base context]\n${contextText}` : "";
  return `${safety}\n\n==========\n👤 PERSONA\n==========\n${persona}\n\n==========\n${tooling}${ctx}`;
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

async function saveMessage(admin: SupabaseClient, conversationId: string, senderType: "customer" | "agent" | "bot" | "system", content: string, metadata: Record<string, unknown> = {}, contentType: string = "text") {
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId, sender_type: senderType, content, content_type: contentType, metadata,
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
  const images = normalizeImages(body.images);
  const history = (body.history ?? []) as Array<{ role: string; content: string }>;
  const match_count = Number(body.match_count ?? DEFAULT_MATCH_COUNT);
  const matchThreshold = Number(body.match_threshold ?? DEFAULT_MATCH_THRESHOLD);
  const wantStream = body.stream !== false;
  const lang: Lang = detectLanguage(query);
  const sessionId = typeof body.session_id === "string" && body.session_id.length >= 8 ? body.session_id : null;
  const displayName = typeof body.display_name === "string" ? body.display_name : "";
  const channelRaw = typeof body.channel === "string" ? body.channel.toLowerCase() : "default";
  const channel = ALLOWED_CHANNELS.has(channelRaw) ? channelRaw : "default";

  if (!query && images.length === 0) return new Response(JSON.stringify({ error: MSG[lang].queryRequired }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  let conversationId: string | null = null;
  if (sessionId) conversationId = await upsertLivechatConversation(admin, sessionId, displayName);
  if (conversationId) {
    if (images.length > 0) {
      const url = await uploadImageToStorage(admin, conversationId, images[0].mimeType, images[0].data);
      const md = url ? `![image](${url})` : "";
      const custContent = [query, md].filter(Boolean).join("\n") || "[รูปภาพ]";
      await saveMessage(admin, conversationId, "customer", custContent, { lang, image_url: url }, "image");
    } else {
      await saveMessage(admin, conversationId, "customer", query, { lang });
    }
  }

  if (wantStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: Record<string, unknown>) => {
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch (_e) { /* closed */ }
        };
        try { await handleQuery(admin, query, images, history, match_count, matchThreshold, lang, channel, conversationId, send); }
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
  try { await handleQuery(admin, query, images, history, match_count, matchThreshold, lang, channel, conversationId, (e) => events.push(e)); }
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

async function handleQuery(admin: SupabaseClient, query: string, images: ImagePart[], history: Array<{ role: string; content: string }>, match_count: number, matchThreshold: number, lang: Lang, channel: string, conversationId: string | null, send: (event: Record<string, unknown>) => void) {
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

  if (query && images.length === 0 && !shouldSkipRAG(query)) {
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
        const bodyTxt = rows.map((r) => r.content).join("\n\n");
        blocks.push(`[ที่มา ${i}: ${sp}${title}]\n${bodyTxt}`); i++;
      }
      contextText = blocks.join("\n\n---\n\n");
    }
  } else {
    send({ type: "status", message: images.length > 0 ? "vision" : "rag_skipped_product_query" });
  }

  const systemPrompt = buildSystemPrompt(persona, contextText, lang);
  const t2 = Date.now();
  const userParts: Array<Record<string, unknown>> = [{ text: query || "ลูกค้าส่งรูปภาพนี้มา ช่วยดูรูปแล้วบอกว่าเป็นสินค้า/งานอะไร และช่วยแนะนำสินค้าที่เกี่ยวข้อง" }];
  for (const im of images) userParts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
  const contents: unknown[] = [
    ...history.map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] })),
    { role: "user", parts: userParts },
  ];
  const usage = zeroTokens();
  const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result_summary?: string }> = [];
  let usedModel = GEMINI_MODELS[0];
  let fullAnswer = "";

  // Post-tool iterations are buffered (not streamed live) so a repeated
  // acknowledgment — the model loves to re-say "เดี๋ยวเอยขอตรวจสอบ..." after
  // the tool result — can be dropped instead of reaching the customer twice.
  const normText = (s: string) => s.replace(/\s+/g, "").replace(/[.,!?;:()\[\]"'`~\-—·]/g, "");
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let iterText = "";
    const r = await streamGeminiWithFallback(geminiKey, systemPrompt, contents, (chunk) => {
      if (iter === 0) {
        fullAnswer += chunk;
        send({ type: "text", chunk });
      } else {
        iterText += chunk;
      }
    });
    if (iter > 0 && iterText) {
      const a = normText(fullAnswer);
      const b = normText(iterText);
      const duplicate = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
      if (!duplicate) {
        const sepNeeded = fullAnswer.trim() && !fullAnswer.endsWith("\n");
        const chunkOut = (sepNeeded ? "\n" : "") + iterText;
        fullAnswer += chunkOut;
        send({ type: "text", chunk: chunkOut });
      }
    }
    usedModel = r.model;
    usage.prompt_tokens += r.usage.prompt_tokens;
    usage.completion_tokens += r.usage.completion_tokens;
    usage.total_tokens += r.usage.total_tokens;
    if (r.toolCalls.length === 0) break;
    contents.push({ role: "model", parts: r.allParts });
    for (const tc of r.toolCalls) { send({ type: "tool_call", name: tc.name, args: tc.args }); }
    const responseParts = await Promise.all(
      r.toolCalls.map(async (call) => {
        const result = await dispatchTool(admin, call.name, call.args, send, channel, conversationId);
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
