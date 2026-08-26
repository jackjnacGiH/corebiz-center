/**
 * rag-chat v51 — family and product-type locked alternatives
 *
 * v50: product suggestions are filtered before reaching the LLM. A recognised
 * product family must match exactly; unknown families need a normalized-name
 * score of at least 70%. This prevents cross-type substitutions such as a
 * sanding belt being offered as a mounted flap wheel. v51 additionally locks
 * the meaningful product-type phrase (for example จานทราย vs ล้อทราย) before
 * evaluating the existing 70% fallback score.
 *
 * v35 — forced retrieval for payment/bank-account queries
 *
 * v33: rule-5 addendum — for quote/order status questions the bot also tells
 * the customer they can self-check at https://www.jnac.online/account.
 *
 * v32: the bot's request_quote tool takes structured items [{sku, qty}] and
 * creates an actual draft quote (same server-side pricing as the storefront
 * cart, QT- number from the sequence) + an agent-queue task referencing it.
 * The customer gets their quote number immediately — same standard as the
 * cart. Falls back to a queue-task-only when SKUs can't be resolved.
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
const MAX_QUERY_CHARS = 4_000;
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_CHARS = 4_000;
const MAX_IMAGE_BASE64_CHARS = 8_000_000;
const PERSONA_CACHE_TTL_MS = 60_000;
const KEYWORD_CACHE_TTL_MS = 60_000;
const BOT_FLAG_CACHE_TTL_MS = 30_000;
const LEARNING_SETTINGS_CACHE_TTL_MS = 30_000;
const MAX_LEARNING_GUIDANCE = 3;
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
let learningSettingsCache: { value: LearningSettings; expires: number } | null = null;

type Lang = "th" | "en";
type ImagePart = { mimeType: string; data: string };
type LearningSettings = {
  enabled: boolean;
  context_memory_enabled: boolean;
  candidate_capture_enabled: boolean;
  memory_ttl_days: number;
  max_context_chars: number;
};
type ConversationMemory = { summary: string; topics: string[] };
type LearningGuidance = { trigger_terms: string[]; approved_guidance: string };
type RoutingVariant = "auto" | "db_region" | "direct";
type RequestTelemetry = {
  requestId: string;
  startedAt: number;
  edgeRegion: string | null;
  routingVariant: RoutingVariant;
  contentKind: "text" | "image";
};

/** Keep non-critical analytics and learning writes off the customer response
 * path. EdgeRuntime.waitUntil lets the isolate finish them after responding. */
function runInBackground(label: string, task: Promise<unknown>): void {
  const guarded = task.catch((error) => {
    console.warn(`${label} background task failed:`, (error as Error).message);
  });
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(guarded);
  else void guarded;
}
function detectLanguage(s: string): Lang {
  return /[฀-๿]/.test(s) ? "th" : "en";
}

function isImageOnlyHistoryEntry(content: string): boolean {
  return /^!\[image\]\(https?:\/\/[^\s)]+\)$/i.test(content.trim());
}

/**
 * A LINE image has no customer text to detect. In that case, preserve the
 * language of the most recent meaningful customer message instead of treating
 * an empty string as English. An entirely textless LINE conversation defaults
 * to Thai, while an explicit English message continues to receive English.
 */
function resolveResponseLanguage(
  query: string,
  history: Array<{ role: string; content: string }>,
  channel: string,
): Lang {
  if (query.trim()) return detectLanguage(query);
  const priorCustomerText = [...history].reverse().find(
    (message) => message.role === "user" && message.content.trim() && !isImageOnlyHistoryEntry(message.content),
  )?.content;
  if (priorCustomerText) return detectLanguage(priorCustomerText);
  return channel === "line" ? "th" : "en";
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
    if (data && data.length <= MAX_IMAGE_BASE64_CHARS && /^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) {
      out.push({ mimeType, data });
    }
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
const CALLBACK_REQUEST_RE = /ติดต่อกลับ|โทรกลับ|(?:ให้|ขอให้|รบกวนให้)(?:พนักงาน|ทีมงาน|เจ้าหน้าที่|คุณเชอร์รี่).*(?:ติดต่อ|โทร)|(?:contact|call).*(?:back|me)/i;
function isCostQuery(s: string): boolean {
  if (!s) return false;
  for (const kw of THAI_COST_KEYWORDS) if (s.indexOf(kw) !== -1) return true;
  for (const re of ASCII_COST_PATTERNS) if (re.test(s)) return true;
  return false;
}
function isCallbackRequest(s: string): boolean { return CALLBACK_REQUEST_RE.test(s); }

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
// Match common Thai spelling variants/typos (โลเคชั่น, โลเคชั้น,
// โลเคชัน) by their stable prefix. Location answers are high-value factual
// replies, so they must not depend on vector similarity alone.
const LOCATION_RE = /โลเคช|แผนที่|ที่อยู่|ที่ตั้ง|โรงงาน|\blocation\b|\baddress\b/i;
const FAQ_HINT_RE = [
  /คืนสินค้า/, /ใบกำกับ/, /ภาษี/, /ตัวแทน/, /สมัคร/, /นโยบาย/, /ส่งของ/, /บัตรเครดิต/, /จัดส่ง/,
  /ที่อยู่/, /ที่ตั้ง/, /โรงงาน/, /แผนที่/, /โลเคช/, /location/i, /เบอร์โทร/, /เบอร์บัญชี/, /email/i, /ติดต่อ/, /เปิดทำ/, /วันหยุด/,
  /\breturn\b/i, /\binvoice\b/i, /\btax\b/i, /\bagent\b/i, /\bpolicy\b/i, /\bshipping\b/i, /\bcredit\s*card\b/i, /\baddress\b/i, /\bphone\b/i, /\bopening\s*hour/i,
  // Payment / bank account — must always trigger RAG to retrieve KB docs
  /เลขบัญชี/, /บัญชีธนาคาร/, /โอนเงิน/, /ชำระเงิน/, /ช่องทางชำระ/, /QR.*code/i, /qr/i, /พร้อมเพย์/, /promptpay/i, /ธนาคาร/, /สแกน.*จ่าย/,
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
      { name: "link_quote_customer", description: "Link the current chat to CRM before creating a quotation. Call only when a quotation is pending and the customer supplies billing details in text or a clearly readable company document/image. Extract exactly what is visible; NEVER guess. Tax ID must contain exactly 13 digits and is the ONLY customer matching key. Require company_name and billing_address too. If any required field is missing or unclear, ask the customer instead of calling.", parameters: { type: "object", properties: { tax_id: { type: "string", description: "exact 13-digit Thai tax ID" }, company_name: { type: "string", description: "legal customer/company name" }, billing_address: { type: "string", description: "complete billing address as one string" }, branch: { type: "string", description: "head office or branch label/code if visible" }, phone: { type: "string", description: "phone if supplied" } }, required: ["tax_id", "company_name", "billing_address"] } },
      { name: "request_quote", description: "Create one REAL draft quotation for a DIRECT customer request with exact items and quantities. The chat MUST already be linked to a CRM customer with a valid 13-digit tax ID; otherwise the tool asks for company name, billing address, tax ID and branch. Pass EXACT SKUs from find_products/get_product_detail results. NEVER call for a thank-you or question about how to order. An image may lead to a quote only when it is the requested billing document and link_quote_customer succeeded in the same flow. The system reuses an existing draft with identical items in the same chat; only tell the customer a quote_code when quote_created=true. Prices are computed server-side — never invent prices.", parameters: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { sku: { type: "string", description: "exact product SKU" }, qty: { type: "number", description: "quantity" } }, required: ["sku", "qty"] }, description: "exact SKUs + quantities" }, name: { type: "string" }, phone: { type: "string" }, note: { type: "string", description: "short Thai note" } }, required: ["items"] } },
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
    const { data, error } = await admin.from("org_settings").select("bot_enabled").eq("id", true).maybeSingle();
    if (error) throw error;
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { enabled = false; /* fail closed: emergency stop must be reliable */ }
  globalBotCache = { enabled, expires: now + BOT_FLAG_CACHE_TTL_MS };
  return enabled;
}

async function isChannelBotEnabled(admin: SupabaseClient, channel: string): Promise<boolean> {
  const now = Date.now();
  const cached = channelBotCache.get(channel);
  if (cached && cached.expires > now) return cached.enabled;
  let enabled = true;
  try {
    const { data, error } = await admin.from("ai_personas").select("bot_enabled").eq("channel", channel).maybeSingle();
    if (error) throw error;
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { enabled = false; }
  channelBotCache.set(channel, { enabled, expires: now + BOT_FLAG_CACHE_TTL_MS });
  return enabled;
}

async function isConversationBotEnabled(admin: SupabaseClient, convId: string): Promise<boolean> {
  const now = Date.now();
  const cached = convBotCache.get(convId);
  if (cached && cached.expires > now) return cached.enabled;
  let enabled = true;
  try {
    const { data, error } = await admin.from("chat_conversations").select("bot_enabled").eq("id", convId).maybeSingle();
    if (error) throw error;
    if (data && (data as Record<string, unknown>).bot_enabled === false) enabled = false;
  } catch (_e) { enabled = false; }
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

/**
 * Product family is a non-negotiable guard for substitutions.  The broad
 * database category (for example "ขัด ตัด เจียร") is intentionally not used:
 * it contains belts, mounted wheels, discs and many other non-interchangeable
 * products.  Unknown families fail closed and need a >=70% normalized name
 * match instead of letting an LLM guess a substitute.
 */
type ProductFamilyRule = { key: string; labelTh: string; pattern: RegExp };
const PRODUCT_FAMILY_RULES: ProductFamilyRule[] = [
  { key: "sanding_belt", labelTh: "ผ้าทรายสายพาน", pattern: /ผ้าทราย\s*สายพาน|sanding\s*belt|abrasive\s*belt/i },
  { key: "mounted_flap_wheel", labelTh: "ล้อทรายมีแกน", pattern: /ล้อทราย\s*มีแกน|mounted\s*flap\s*wheel/i },
  { key: "flap_disc", labelTh: "จานทรายซ้อน", pattern: /จานทราย\s*ซ้อน|flap\s*disc/i },
  { key: "sanding_disc_velcro", labelTh: "กระดาษทรายกลมสักหลาด", pattern: /กระดาษทรายกลม\s*สักหลาด|velcro\s*(?:sanding\s*)?disc/i },
  { key: "sanding_disc_adhesive", labelTh: "กระดาษทรายกลมหลังกาว", pattern: /กระดาษทรายกลม\s*หลังกาว|adhesive\s*(?:sanding\s*)?disc/i },
  { key: "sanding_roll", labelTh: "ผ้าทรายม้วน", pattern: /ผ้าทราย\s*ม้วน|abrasive\s*roll|sanding\s*roll/i },
  // Catalog and customers use both ลูกขัด... and ล้อขัด... for this same product family.
  { key: "nonwoven_wheel", labelTh: "ล้อขัดใยสังเคราะห์", pattern: /(?:ล้อ|ลูก)\s*ขัด\s*ใย\s*สังเคราะห์|scotch\s*brite\s*wheel|nonwoven\s*wheel/i },
  { key: "hairline_wheel", labelTh: "ล้อขัดแฮร์ไลน์", pattern: /ล้อขัด.*แฮร์ไลน์|hairline\s*wheel/i },
  { key: "pva_disc", labelTh: "ใบขัดกระจก PVA", pattern: /ใบขัดกระจก|pva\s*(?:spongy\s*)?disc/i },
  { key: "rubber_expander", labelTh: "ลูกยาง", pattern: /ลูกยาง|rubber\s*expander/i },
];

function productFamilyFor(text: string): string | null {
  return PRODUCT_FAMILY_RULES.find((rule) => rule.pattern.test(text))?.key ?? null;
}

function productFamilyLabel(family: string | null): string | null {
  return PRODUCT_FAMILY_RULES.find((rule) => rule.key === family)?.labelTh ?? null;
}

/**
 * Product-type anchors are the meaningful leading phrase that identifies what
 * the customer is asking for. Thai product names are not reliably delimited by
 * whitespace, so this is intentionally semantic (for example "จานทราย" and
 * "ล้อทราย") instead of splitting the first two whitespace tokens.
 *
 * A specific family, when present, is still stricter. These anchors close the
 * gap for short customer queries such as "จานทราย 4 นิ้ว" where the more
 * specific family word ("ซ้อน") was not included.
 */
type ProductTypeRule = { key: string; labelTh: string; pattern: RegExp };
const PRODUCT_TYPE_RULES: ProductTypeRule[] = [
  { key: "sanding_belt", labelTh: "ผ้าทรายสายพาน", pattern: /ผ้าทราย\s*สายพาน|sanding\s*belt|abrasive\s*belt/i },
  { key: "sanding_roll", labelTh: "ผ้าทรายม้วน", pattern: /ผ้าทราย\s*ม้วน|abrasive\s*roll|sanding\s*roll/i },
  { key: "mounted_flap_wheel", labelTh: "ล้อทราย", pattern: /ล้อทราย(?:\s*มีแกน)?|mounted\s*flap\s*wheel/i },
  { key: "flap_disc", labelTh: "จานทราย", pattern: /จานทราย(?:\s*ซ้อน)?|flap\s*disc/i },
  { key: "sanding_disc", labelTh: "กระดาษทรายกลม", pattern: /กระดาษทราย\s*กลม|(?:velcro|adhesive)\s*(?:sanding\s*)?disc/i },
  // Keep the same semantic anchor as PRODUCT_FAMILY_RULES; this is a hard gate.
  { key: "nonwoven_wheel", labelTh: "ล้อขัดใยสังเคราะห์", pattern: /(?:ล้อ|ลูก)\s*ขัด\s*ใย\s*สังเคราะห์|scotch\s*brite\s*wheel|nonwoven\s*wheel/i },
  { key: "hairline_wheel", labelTh: "ล้อขัดแฮร์ไลน์", pattern: /ล้อขัด.*แฮร์ไลน์|hairline\s*wheel/i },
  { key: "pva_disc", labelTh: "ใบขัดกระจก PVA", pattern: /ใบขัดกระจก|pva\s*(?:spongy\s*)?disc/i },
  { key: "rubber_expander", labelTh: "ลูกยาง", pattern: /ลูกยาง|rubber\s*expander/i },
];

function productTypeFor(text: string): string | null {
  return PRODUCT_TYPE_RULES.find((rule) => rule.pattern.test(text))?.key ?? null;
}

function productTypeLabel(productType: string | null): string | null {
  return PRODUCT_TYPE_RULES.find((rule) => rule.key === productType)?.labelTh ?? null;
}

function normalizedProductName(text: string): string {
  return text.toLowerCase()
    .replace(/\b(?:paco|mirka|jnac)\b/gi, " ")
    .replace(/\b(?:รุ่น|model|size|เบอร์|grit)\b/gi, " ")
    .replace(/#\s*\d+[a-z]*/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mm|มม\.?|inch|นิ้ว)?(?:\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:mm|มม\.?|inch|นิ้ว)?){0,2}\b/gi, " ")
    .replace(/\b[a-z]{1,4}\d+[a-z0-9-]*\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ").trim();
}

function normalizedNameScore(a: string, b: string): number {
  const left = normalizedProductName(a);
  const right = normalizedProductName(b);
  if (!left || !right) return 0;
  if (left === right || left.includes(right) || right.includes(left)) return 1;
  const grams = (value: string) => {
    const compact = value.replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i < compact.length - 1; i++) out.add(compact.slice(i, i + 2));
    return out;
  };
  const aGrams = grams(left), bGrams = grams(right);
  if (aGrams.size === 0 || bGrams.size === 0) return 0;
  let common = 0;
  for (const gram of aGrams) if (bGrams.has(gram)) common++;
  return (2 * common) / (aGrams.size + bGrams.size);
}

type SafeProductMatch = {
  safe: boolean;
  requestedFamily: string | null;
  candidateFamily: string | null;
  requestedProductType: string | null;
  candidateProductType: string | null;
  nameScore: number;
  basis: "exact_sku" | "same_family" | "same_product_type" | "name_score" | "rejected";
};

function evaluateProductMatch(query: string, product: Record<string, unknown>): SafeProductMatch {
  const candidateText = [product.name_th, product.name_en, (product.group as { name?: string } | null)?.name]
    .filter(Boolean).join(" ");
  const requestedFamily = productFamilyFor(query);
  const candidateFamily = productFamilyFor(candidateText);
  const requestedProductType = productTypeFor(query);
  const candidateProductType = productTypeFor(candidateText);
  const sku = String(product.sku ?? "").trim();
  const exactSku = Boolean(sku) && query.toLowerCase().includes(sku.toLowerCase());
  const nameScore = normalizedNameScore(query, candidateText);
  if (exactSku) return {
    safe: true, requestedFamily, candidateFamily, requestedProductType, candidateProductType,
    nameScore: 1, basis: "exact_sku",
  };
  // Once a product type is known, do not allow a high textual score to cross
  // its boundary. A sanding belt must never become a mounted flap wheel.
  if (requestedFamily) {
    if (requestedFamily === candidateFamily) {
      return {
        safe: true, requestedFamily, candidateFamily, requestedProductType, candidateProductType,
        nameScore: Math.max(nameScore, 1), basis: "same_family",
      };
    }
    return { safe: false, requestedFamily, candidateFamily, requestedProductType, candidateProductType, nameScore, basis: "rejected" };
  }
  // The customer's core product phrase is a hard gate before name scoring.
  // This preserves the 0.70 fallback for truly unknown product types, while
  // preventing จานทราย -> ล้อทราย and other cross-type suggestions.
  if (requestedProductType) {
    if (requestedProductType === candidateProductType) {
      return {
        safe: true, requestedFamily, candidateFamily, requestedProductType, candidateProductType,
        nameScore: Math.max(nameScore, 1), basis: "same_product_type",
      };
    }
    return { safe: false, requestedFamily, candidateFamily, requestedProductType, candidateProductType, nameScore, basis: "rejected" };
  }
  return nameScore >= 0.7
    ? { safe: true, requestedFamily, candidateFamily, requestedProductType, candidateProductType, nameScore, basis: "name_score" }
    : { safe: false, requestedFamily, candidateFamily, requestedProductType, candidateProductType, nameScore, basis: "rejected" };
}

function formatSafeProductForLLM(product: Record<string, unknown>, match: SafeProductMatch) {
  return {
    ...formatProductForLLM(product),
    product_family: match.candidateFamily,
    product_type: match.candidateProductType,
    safe_name_score: Number(match.nameScore.toFixed(3)),
    safe_match_basis: match.basis,
    safe_alternative: true,
  };
}

async function findProducts(admin: SupabaseClient, query: string) {
  const original = (query ?? "").trim();
  if (!original) return { products: [], note: "empty query" };

  const { rewritten, applied } = await rewriteWithKeywords(admin, original);
  const q = rewritten;
  const requestedFamily = productFamilyFor(q);
  const requestedProductType = productFamilyLabel(requestedFamily) ?? productTypeLabel(productTypeFor(q));

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

  const directMatches = ((data ?? []) as Record<string, unknown>[])
    .map((p) => ({ p, match: evaluateProductMatch(q, p) }))
    .filter(({ match }) => match.safe);

  if (directMatches.length > 0) {
    return {
      query: q, original_query: original !== q ? original : undefined,
      synonym_rewrites: applied.length > 0 ? applied : undefined,
      tokens,
      stripped: rawTokens.length !== tokens.length ? rawTokens.filter((t) => !tokens.includes(t)) : [],
      requested_product_family: requestedFamily,
      requested_product_type: requestedProductType,
      count: directMatches.length,
      products: directMatches.map(({ p, match }) => formatSafeProductForLLM(p, match)),
    };
  }

  try {
    const { data: fuzzy } = await admin.rpc("search_products_fuzzy", {
      p_query: q, p_limit: 3, p_threshold: 0.2,
    }) as { data: Array<{ product_id: string; sku: string; name_th: string; name_en: string; sim: number }> | null };
    const safeFuzzy = (fuzzy ?? [])
      .map((p) => ({ p: p as unknown as Record<string, unknown>, match: evaluateProductMatch(q, p as unknown as Record<string, unknown>) }))
      .filter(({ match }) => match.safe);
    if (safeFuzzy.length > 0) {
      return {
        query: q, original_query: original !== q ? original : undefined,
        synonym_rewrites: applied.length > 0 ? applied : undefined,
        tokens, requested_product_family: requestedFamily, requested_product_type: requestedProductType, count: 0, products: [],
        clarification_candidates: safeFuzzy.map(({ p, match }) => ({
          sku: p.sku, name_th: p.name_th, name_en: p.name_en ?? null,
          product_family: match.candidateFamily,
          product_type: match.candidateProductType,
          safe_name_score: Number(match.nameScore.toFixed(3)),
          safe_match_basis: match.basis,
          safe_alternative: true,
        })),
        note: "เสนอได้เฉพาะรายการที่ tool ระบุ safe_alternative=true เท่านั้น: ชนิดสินค้าต้องตรงกัน หรือชื่อที่ normalize แล้วตรงตั้งแต่ 70% ขึ้นไป. ห้ามเสนอสินค้าคนละชนิดเด็ดขาด; ถ้าไม่มีตัวเลือกที่ปลอดภัย ให้ส่งเรื่องตรวจสอบจัดหา/สั่งผลิตแทน",
      };
    }
  } catch (_e) { /* fuzzy unavailable */ }

  return {
    query: q, original_query: original !== q ? original : undefined,
    synonym_rewrites: applied.length > 0 ? applied : undefined,
    tokens,
    stripped: rawTokens.length !== tokens.length ? rawTokens.filter((t) => !tokens.includes(t)) : [],
    requested_product_family: requestedFamily, requested_product_type: requestedProductType, count: 0, products: [],
    note: `ยังไม่มีตัวเลือกที่ยืนยันได้ว่าเป็นชนิดเดียวกันหรือชื่อที่ normalize แล้วตรงตั้งแต่ 70%${requestedProductType ? ` สำหรับ${requestedProductType}` : ""} — ห้ามเสนอสินค้าคนละชนิด. ให้ส่งเรื่องตรวจสอบจัดหา/สั่งผลิตแทน`,
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
    price: effective, // Actual selling price after discount
    original_price: discounted ? Number(p.price ?? 0) : null, // Original list price before discount
    discount_value: Number(p.discount_value ?? 0), discount_type: p.discount_type ?? null,
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
  userQuery: string,
  hasImages: boolean,
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
      case "link_quote_customer": return await linkQuoteCustomer(admin, args, conversationId);
      case "request_quote":       return await requestQuote(admin, args, channel, conversationId, userQuery, hasImages);
      default: return { error: `Unknown tool: ${name}` };
    }
  } catch (e) { return { error: (e as Error).message ?? String(e) }; }
}

const cleanStr = (v: unknown) => { const t = (v == null ? "" : String(v)).trim(); return t || null; };

async function getQuoteCustomerState(admin: SupabaseClient, conversationId: string | null): Promise<{
  ready: boolean; recentlyLinked: boolean;
}> {
  if (!conversationId) return { ready: false, recentlyLinked: false };
  const { data: conversation, error: conversationError } = await admin
    .from("chat_conversations").select("customer_id, metadata").eq("id", conversationId).maybeSingle();
  if (conversationError) throw conversationError;
  const customerId = (conversation as { customer_id?: string | null } | null)?.customer_id;
  if (!customerId) return { ready: false, recentlyLinked: false };
  const { data: customer, error: customerError } = await admin
    .from("customers").select("tax_id").eq("id", customerId).maybeSingle();
  if (customerError) throw customerError;
  const taxId = String((customer as { tax_id?: string | null } | null)?.tax_id ?? "").replace(/\D/g, "");
  const metadata = ((conversation as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? {});
  const linkedAt = Date.parse(String(metadata.quote_customer_linked_at ?? ""));
  return { ready: taxId.length === 13, recentlyLinked: Number.isFinite(linkedAt) && Date.now() - linkedAt < 2 * 60_000 };
}

async function linkQuoteCustomer(admin: SupabaseClient, args: Record<string, unknown>, conversationId: string | null): Promise<unknown> {
  if (!conversationId) return { ok: false, linked: false, reason: "conversation_required" };
  const taxId = String(args.tax_id ?? "").replace(/\D/g, "");
  const companyName = cleanStr(args.company_name);
  const billingAddress = cleanStr(args.billing_address);
  if (taxId.length !== 13 || !companyName || !billingAddress) {
    return { ok: true, linked: false, customer_details_required: true, message: "ข้อมูลออกใบเสนอราคายังไม่ครบ กรุณาขอชื่อบริษัท ที่อยู่ออกบิล เลขผู้เสียภาษี 13 หลัก และสาขา (ถ้ามี) จากลูกค้า ห้ามเดาข้อมูล" };
  }
  const { data, error } = await admin.rpc("link_chat_customer_by_tax", {
    p_conversation_id: conversationId, p_tax_id: taxId, p_company_name: companyName,
    p_billing_address: billingAddress, p_branch: cleanStr(args.branch), p_phone: cleanStr(args.phone),
  });
  if (error) throw error;
  const result = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  const status = String(result?.link_status ?? "unknown");
  if (status === "conversation_customer_conflict") {
    return { ok: true, linked: false, conflict: true, message: "ห้องแชตผูกกับลูกค้าคนละเลขผู้เสียภาษีอยู่แล้ว ให้ทีมงานตรวจสอบ ห้ามเปลี่ยนการผูกอัตโนมัติ" };
  }
  if (status !== "linked" && status !== "already_linked") {
    return { ok: true, linked: false, customer_details_required: true, reason: status, message: "ข้อมูลออกใบเสนอราคาไม่ถูกต้องหรือไม่ครบ กรุณาขอข้อมูลจากลูกค้าใหม่ ห้ามเดา" };
  }
  return { ok: true, linked: true, matched_by: "tax_id", customer_name: result?.customer_name, message: "ผูกข้อมูลลูกค้าด้วยเลขผู้เสียภาษีเรียบร้อย สามารถดำเนินการสร้างใบเสนอราคาต่อได้" };
}

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

function quoteCreationBlockReason(userQuery: string, hasImages: boolean): string | null {
  if (hasImages) return "image_or_document";
  const text = userQuery.trim();
  if (!text) return "empty_message";
  if (/^(?:ขอบคุณ|ขอบใจ|thanks?|thank\s+you)(?:\s*(?:มาก|มากครับ|มากค่ะ|ครับ|ค่ะ|นะ|นะครับ|นะคะ|so\s+much|very\s+much|again|!|🙏|😊|🙂))*$/iu.test(text)) {
    return "acknowledgement";
  }
  if (/(?:สั่งสินค้า|สั่งของ).{0,16}(?:ยังไง|อย่างไร|วิธี)|(?:วิธี|ขั้นตอน).{0,16}(?:สั่งสินค้า|สั่งของ)/iu.test(text)) {
    return "ordering_information";
  }
  return null;
}

/**
 * Create or reuse a real draft quote. The database owns the operation so two
 * concurrent webhook events cannot each create a document for the same chat
 * and exact item set.
 */
async function requestQuote(
  admin: SupabaseClient,
  args: Record<string, unknown>,
  channel: string,
  conversationId: string | null,
  userQuery: string,
  hasImages: boolean,
): Promise<unknown> {
  const customerState = await getQuoteCustomerState(admin, conversationId);
  if (!customerState.ready) {
    return {
      ok: true, saved: false, skipped: true, quote_created: false, quote_reused: false,
      customer_details_required: true, reason: "tax_customer_required",
      message: "ก่อนออกใบเสนอราคา กรุณาขอชื่อบริษัท ที่อยู่ออกบิล เลขผู้เสียภาษี 13 หลัก และสาขา (ถ้ามี) จากลูกค้า โดยรับได้ทั้งข้อความหรือรูปเอกสารที่อ่านชัดเจน แล้วเรียก link_quote_customer ก่อน ห้ามสร้างใบเสนอราคาที่ยังไม่ผูก CRM",
    };
  }
  const blockReason = quoteCreationBlockReason(userQuery, hasImages && !customerState.recentlyLinked);
  if (blockReason) {
    return {
      ok: true, saved: false, skipped: true, quote_created: false, quote_reused: false,
      reason: blockReason,
      message: "ข้อความนี้ไม่ใช่คำขอออกใบเสนอราคาใหม่โดยตรง — ห้ามสร้างใบเสนอราคาใหม่",
    };
  }

  const name = cleanStr(args.name), phone = cleanStr(args.phone), note = cleanStr(args.note);
  const reqItems: Array<{ sku: string; qty: number }> = [];
  if (Array.isArray(args.items)) {
    for (const it of args.items as Array<Record<string, unknown>>) {
      const sku = String(it?.sku ?? "").trim().toUpperCase();
      const qty = Math.max(1, Math.floor(Number(it?.qty) || 1));
      if (sku) reqItems.push({ sku, qty });
    }
  }
  const itemsText = reqItems.length > 0
    ? reqItems.map((i) => `${i.sku} x${i.qty}`).join(", ")
    : cleanStr(args.items);

  if (conversationId && reqItems.length > 0) {
    const { data, error } = await admin.rpc("create_or_reuse_bot_quote", {
      p_conversation_id: conversationId,
      p_channel: channel,
      p_items: reqItems,
      p_name: name,
      p_phone: phone,
      p_note: note,
    });
    if (error) throw error;
    const quote = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (quote?.items_resolved === true && quote.quote_created === true && typeof quote.quote_code === "string") {
      return {
        ok: true, saved: true, quote_created: true, quote_reused: false,
        quote_code: quote.quote_code, estimated_total_incl_vat: Number(quote.quote_total ?? 0),
        message: `สร้างใบเสนอราคาฉบับร่างเลขที่ ${quote.quote_code} แล้ว — แจ้งเลขที่นี้กับลูกค้า และบอกว่าทีมงานจะตรวจสอบ/ยืนยันราคาสุทธิแล้วติดต่อกลับโดยเร็ว`,
      };
    }
    if (quote?.items_resolved === true && quote.quote_reused === true && typeof quote.quote_code === "string") {
      return {
        ok: true, saved: true, quote_created: false, quote_reused: true,
        existing_quote_code: quote.quote_code,
        message: `พบใบเสนอราคาฉบับร่าง ${quote.quote_code} สำหรับรายการและจำนวนเดิมแล้ว — ห้ามสร้างใบเสนอราคาใหม่หรือบอกว่าพึ่งสร้างใหม่`,
      };
    }
  }

  const summary = [itemsText && `รายการ: ${itemsText}`, name && `ชื่อ: ${name}`,
    phone && `ติดต่อ: ${phone}`, note && `โน้ต: ${note}`].filter(Boolean).join(" · ");
  await admin.rpc("agent_propose", {
    p_category: "sales",
    p_kind: "sales.quote_request",
    p_title: `ขอใบเสนอราคาจากแชท${itemsText ? `: ${itemsText.slice(0, 60)}` : ""}`,
    p_summary: summary || "ลูกค้าขอใบเสนอราคาจากแชท",
    p_recommendation: "แนะนำให้จัดทำใบเสนอราคาและติดต่อยืนยันกับลูกค้า",
    p_payload: { items: itemsText, structured_items: reqItems, quote_id: null, quote_code: null, name, phone, note, channel, conversation_id: conversationId },
    p_action_kind: "convert_quote",
    p_requires_approval: true,
    p_priority: 1,
    p_related_type: conversationId ? "conversation" : null,
    p_related_id: conversationId,
    p_dedupe_key: conversationId ? `sales.quote_request.unresolved.${conversationId}` : null,
    p_source: "bot",
  });
  return { ok: true, saved: true, quote_created: false, quote_reused: false, message: "รับเรื่องขอใบเสนอราคาแล้ว ทีมงานจะจัดทำและติดต่อกลับโดยเร็ว" };
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

const LEARNING_DEFAULTS: LearningSettings = {
  enabled: false,
  context_memory_enabled: false,
  candidate_capture_enabled: false,
  memory_ttl_days: 90,
  max_context_chars: 600,
};

function redactLearningText(input: string, maxChars = 500): string {
  return input
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:\+?66|0)(?:[\s-]?\d){8,10}/g, "[phone]")
    .replace(/\b(?:\d[ -]?){10,16}\b/g, "[sensitive-number]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function isSensitiveLearningInput(input: string): boolean {
  return /(?:\bPO\b|purchase\s*order|bank\s*account|payment\s*slip|transfer\s*slip|เลขบัญชี|บัญชีธนาคาร|สลิป|โอนเงิน|ใบสั่งซื้อ)/iu.test(input);
}

function isSafeLearningGuidance(input: string): boolean {
  // A staff review can improve how the bot listens or asks a follow-up; it
  // must never become an alternate source of commercial facts or private data.
  return !isSensitiveLearningInput(input) && !/(?:\bcost\b|\bmargin\b|\bprice\b|\bstock\b|\binventory\b|ราคา|สต็อก|คงเหลือ|จำนวน)/iu.test(input);
}

function isLearningCandidateEligible(input: string): boolean {
  // A review queue should represent genuine knowledge gaps, not routine lead
  // capture, price/stock handling, or adversarial messages. This keeps the
  // staff queue actionable and prevents a prompt-injection attempt becoming a
  // learning candidate even though it could never be applied automatically.
  if (isSensitiveLearningInput(input)) return false;
  return !/(?:ignore\s+(?:all\s+)?previous|system\s*prompt|developer\s*message|jailbreak|company\s*secrets|\bcost\b|\bmargin\b|\bprice\b|\bstock\b|\binventory\b|ราคา|ราคาทุน|สต็อก|คงเหลือ|จำนวน)/iu.test(input);
}

function normalizeLearningMatch(input: string): string {
  return input.toLowerCase().replace(/[\s\-_/.,!?;:()[\]{}"'`~]/g, "");
}

function learningFingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function learningTopics(query: string, toolNames: string[]): string[] {
  const topics: string[] = [];
  if (/สินค้า|ราคา|ขนาด|เบอร์|SKU|product|price|size/i.test(query)) topics.push("product");
  if (/ใบเสนอราคา|quote|QT-/i.test(query) || toolNames.includes("request_quote")) topics.push("quote");
  if (/จัดส่ง|ส่งของ|delivery|shipping/i.test(query)) topics.push("delivery");
  if (/แผนที่|location|โลเคชั่น|ที่อยู่/i.test(query)) topics.push("location");
  if (toolNames.includes("capture_lead")) topics.push("follow_up");
  return [...new Set(topics)].slice(0, 8);
}

async function getLearningSettings(admin: SupabaseClient): Promise<LearningSettings> {
  const now = Date.now();
  if (learningSettingsCache && learningSettingsCache.expires > now) return learningSettingsCache.value;
  try {
    const { data, error } = await admin.from("bot_learning_settings")
      .select("enabled, context_memory_enabled, candidate_capture_enabled, memory_ttl_days, max_context_chars")
      .eq("id", true).maybeSingle();
    if (error || !data) throw error ?? new Error("missing learning settings");
    const row = data as Partial<LearningSettings>;
    const value: LearningSettings = {
      enabled: row.enabled === true,
      context_memory_enabled: row.context_memory_enabled === true,
      candidate_capture_enabled: row.candidate_capture_enabled === true,
      memory_ttl_days: Math.max(7, Math.min(365, Number(row.memory_ttl_days) || 90)),
      max_context_chars: Math.max(160, Math.min(1200, Number(row.max_context_chars) || 600)),
    };
    learningSettingsCache = { value, expires: now + LEARNING_SETTINGS_CACHE_TTL_MS };
    return value;
  } catch (e) {
    console.warn("bot learning settings unavailable; learning is paused:", (e as Error).message);
    return LEARNING_DEFAULTS;
  }
}

async function loadConversationMemory(admin: SupabaseClient, conversationId: string | null, settings: LearningSettings): Promise<ConversationMemory | null> {
  if (!conversationId || !settings.enabled || !settings.context_memory_enabled) return null;
  try {
    const { data, error } = await admin.from("bot_conversation_memory")
      .select("summary, topics").eq("conversation_id", conversationId)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) return null;
    const row = data as { summary?: unknown; topics?: unknown };
    const summary = redactLearningText(String(row.summary ?? ""), settings.max_context_chars);
    const topics = Array.isArray(row.topics) ? row.topics.map(String).slice(0, 8) : [];
    return summary ? { summary, topics } : null;
  } catch (e) {
    console.warn("bot conversation memory read failed:", (e as Error).message);
    return null;
  }
}

async function loadApprovedLearningGuidance(admin: SupabaseClient, query: string, settings: LearningSettings): Promise<LearningGuidance[]> {
  if (!settings.enabled || !query || isSensitiveLearningInput(query)) return [];
  const normalizedQuery = normalizeLearningMatch(query);
  if (normalizedQuery.length < 3) return [];
  try {
    const { data, error } = await admin.from("bot_learning_candidates")
      .select("trigger_terms, approved_guidance")
      .eq("status", "approved")
      .not("approved_guidance", "is", null)
      .order("last_seen_at", { ascending: false }).limit(50);
    if (error) throw error;
    return ((data ?? []) as Array<{ trigger_terms?: unknown; approved_guidance?: unknown }>)
      .map((row) => ({
        trigger_terms: Array.isArray(row.trigger_terms) ? row.trigger_terms.map(String).slice(0, 8) : [],
        approved_guidance: String(row.approved_guidance ?? "").trim().slice(0, 1200),
      }))
      .filter((row) => row.approved_guidance && isSafeLearningGuidance(row.approved_guidance) && row.trigger_terms.some((term) => {
        const normalizedTerm = normalizeLearningMatch(term);
        return normalizedTerm.length >= 3 && normalizedQuery.includes(normalizedTerm);
      }))
      .slice(0, MAX_LEARNING_GUIDANCE);
  } catch (e) {
    console.warn("approved learning guidance read failed:", (e as Error).message);
    return [];
  }
}

async function saveConversationMemory(admin: SupabaseClient, conversationId: string | null, channel: string, query: string, toolNames: string[], settings: LearningSettings): Promise<void> {
  if (!conversationId || !settings.enabled || !settings.context_memory_enabled || !query || isSensitiveLearningInput(query)) return;
  const safeQuery = redactLearningText(query, Math.max(80, settings.max_context_chars - 42));
  if (safeQuery.length < 3) return;
  try {
    const expiresAt = new Date(Date.now() + settings.memory_ttl_days * 24 * 60 * 60 * 1000).toISOString();
    await admin.from("bot_conversation_memory").upsert({
      conversation_id: conversationId,
      summary: `Latest customer context: ${safeQuery}`.slice(0, settings.max_context_chars),
      topics: learningTopics(query, toolNames),
      source_channel: channel,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: "conversation_id" });
  } catch (e) {
    console.warn("bot conversation memory write failed:", (e as Error).message);
  }
}

async function recordLearningCandidate(admin: SupabaseClient, input: {
  conversationId: string | null;
  channel: string;
  query: string;
  sourceCount: number;
  toolNames: string[];
  settings: LearningSettings;
}): Promise<void> {
  if (!input.settings.enabled || !input.settings.candidate_capture_enabled || !input.query || isSensitiveLearningInput(input.query)) return;
  const candidateKind = input.sourceCount === 0
    && input.toolNames.length === 0
    && input.query.trim().length >= 8
    && isLearningCandidateEligible(input.query)
    ? "knowledge_gap"
    : null;
  if (!candidateKind) return;
  const sampleText = redactLearningText(input.query);
  const normalized = normalizeLearningMatch(sampleText);
  if (normalized.length < 4) return;
  const fingerprint = learningFingerprint(`${candidateKind}:${normalized}`);
  try {
    const { data: existing, error: findError } = await admin.from("bot_learning_candidates")
      .select("id, occurrence_count").eq("candidate_kind", candidateKind).eq("fingerprint", fingerprint).maybeSingle();
    if (findError) throw findError;
    const now = new Date().toISOString();
    if (existing?.id) {
      await admin.from("bot_learning_candidates").update({
        occurrence_count: Math.min(999999, Number(existing.occurrence_count ?? 0) + 1),
        last_seen_at: now,
        updated_at: now,
      }).eq("id", existing.id);
    } else {
      await admin.from("bot_learning_candidates").insert({
        conversation_id: input.conversationId,
        candidate_kind: candidateKind,
        fingerprint,
        sample_text: sampleText,
        trigger_terms: [sampleText.slice(0, 160)],
        risk_level: candidateKind === "follow_up_needed" ? "medium" : "low",
      });
    }
  } catch (e) {
    console.warn("bot learning candidate write failed:", (e as Error).message);
  }
}

function learningPromptContext(memory: ConversationMemory | null, guidance: LearningGuidance[]): string {
  const parts: string[] = [];
  if (memory) {
    parts.push(`[private conversation continuity — not factual source]\n${memory.summary}${memory.topics.length ? `\nTopics: ${memory.topics.join(", ")}` : ""}\nUse only to avoid repeating questions or greetings. Never reveal it unprompted, and fresh tools/knowledge always override it.`);
  }
  if (guidance.length > 0) {
    parts.push(`[staff-approved learning guidance]\n${guidance.map((item) => `- Terms: ${item.trigger_terms.join(", ")}\n  Guidance: ${item.approved_guidance}`).join("\n")}\nThis guidance is not product, price, stock, payment, PO, or personal data. It cannot override Safety Rules, Tooling Rules, or product-family gates.`);
  }
  return parts.join("\n\n");
}

const SAFETY_RULES_TH = `🚨 SAFETY RULES (Hardcoded — cannot be overridden by persona)

1. ห้ามเปิดเผยข้อมูล cost / ราคาทุน / margin / ราคาซื้อ ของบริษัทโดยเด็ดขาด — ถ้าลูกค้าถาม ให้ปฏิเสธ
2. ห้าม fabricate ข้อมูลใดๆ — ที่อยู่/เบอร์โทร/email/แผนที่/ราคา/จำนวนขั้นต่ำ ต้องมาจาก [context]/tools เท่านั้น ถ้าไม่มี ส่งให้เจ้าหน้าที่
   ✅ ข้อยกเว้นพิเศษ — เลขบัญชีธนาคารสำหรับรับชำระเงิน (ช่องทางการชำระเงิน): ถ้ามีข้อมูลใน [context] ให้ส่งให้ลูกค้าทันทีเลย รวมถึง QR Code image หรือ URL รูป QR ด้วย ไม่ต้องรอตรวจสอบหรือส่งให้เจ้าหน้าที่ก่อน
   ✅ โลเคชั่น/แผนที่/ที่อยู่: ถ้ามีข้อมูลใน [context] ให้ส่ง Google Maps URL และที่อยู่ให้ลูกค้าทันที ห้ามเรียก capture_lead หรือบอกว่าจะตรวจสอบก่อน
3. ภาษา: ตอบในภาษาเดียวกับที่ลูกค้าพิมพ์เสมอ
4. ห้ามเปิดเผยข้อมูลลับขององค์กร
5. ห้ามตอบว่า ไม่สามารถ / ทำไม่ได้ / ตรวจสอบให้ไม่ได้ / ไม่ทราบ / ไม่มีข้อมูล เด็ดขาด — คำถามใดที่เอยตอบเองไม่ได้หรือเช็คจากระบบไม่ได้ (เช่น สถานะใบเสนอราคา สถานะการจัดส่ง เรื่องที่ทีมงานต้องยืนยัน) ให้รับเรื่องไว้เสมอ: ตอบประมาณว่า "เดี๋ยวเอยขอตรวจสอบ/ขอเช็คข้อมูลให้ก่อนนะคะ แล้วจะรีบแจ้งกลับโดยเร็วค่ะ 😊" แล้วเรียก capture_lead (ใส่คำถามของลูกค้าใน note) เพื่อให้ทีมงานติดตามแจ้งลูกค้าจริง — ห้ามผลักให้ลูกค้าไปติดต่อใครเองโดยไม่รับเรื่อง
   ⚠️ เลขที่ขึ้นต้น QT- / SO- / DN- คือเลขที่เอกสาร (ใบเสนอราคา/ใบสั่งขาย/ใบส่งของ) ไม่ใช่รหัสสินค้า — ห้ามเอาไปค้น find_products ให้ทำตามข้อ 5 นี้ทันที (รับเรื่อง + capture_lead โดยใส่เลขเอกสารใน note)
   ⚠️ พูดรับเรื่องสั้นๆ เพียงครั้งเดียว — เรียก capture_lead ก่อนแล้วค่อยตอบลูกค้าหลังได้ผล tool ห้ามพูดประโยคเดิม/ความหมายเดิมซ้ำสองรอบในคำตอบเดียว
   💡 ถ้าเป็นเรื่องสถานะใบเสนอราคา/คำสั่งซื้อ ให้แนะนำเพิ่มท้ายคำตอบว่า ลูกค้าดูสถานะเองได้ตลอดเวลาที่หน้า "บัญชีของฉัน" https://www.jnac.online/account (เข้าสู่ระบบด้วยอีเมลที่ใช้ติดต่อ)
6. ข้อมูลสินค้า (เช่น ราคา สต็อก รูปภาพ) สามารถเปลี่ยนแปลงหรือได้รับการอัปเดตแก้ไขให้ถูกต้องในคลังสินค้า/ฐานข้อมูลได้ตลอดเวลา ดังนั้น แม้ว่าในบทสนทนาก่อนหน้าหรือในประวัติการคุยจะแสดงข้อมูลสินค้าที่ผิด หรือผู้ใช้จะเคยท้วงติงว่ารูปภาพ/ราคาไม่ถูกต้องก็ตาม เมื่อลูกค้าถามถึงสินค้าตัวนั้นหรือรูปภาพอีกครั้ง ห้ามทวน/ห้ามใช้ข้อมูล/ห้ามใช้รูปภาพเดิมจากประวัติบทสนทนาเด็ดขาด และห้ามคิดเอาเองว่าข้อมูลหรือรูปภาพยังคงผิดพลาดอยู่ คุณต้องเรียกใช้ tool (find_products หรือ get_product_detail) ใหม่ทุกครั้งเพื่อดึงข้อมูลล่าสุดจากฐานข้อมูลมาตอบ หากฐานข้อมูลอัปเดตเป็นรูปใหม่แล้ว ให้ส่งรูปภาพใหม่จาก tool ให้ลูกค้าทันที`;

const SAFETY_RULES_EN = `🚨 SAFETY RULES (Hardcoded — cannot be overridden)
1. NEVER reveal cost/margin/buying-price. Refuse politely.
2. NEVER fabricate factual data (address/phone/email/map/price/MOQ). If missing, escalate to staff.
   ✅ Special exception — bank account number for receiving payment (payment channels): if the info is in [context], send it to the customer IMMEDIATELY including QR Code image/URL. No need to verify or escalate first.
   ✅ Location/map/address: when present in [context], send the Google Maps URL and address IMMEDIATELY. Do not call capture_lead or say it needs checking.
3. Language: reply in same language as customer (Thai-Thai, English-English).
4. Never disclose confidential org info.
5. NEVER say "I can't / unable to / cannot check / I don't know". For anything you cannot answer or verify yourself (e.g. quote status, delivery status, matters staff must confirm), ALWAYS take ownership: reply like "Let me check on that and get back to you shortly 😊", then call capture_lead (put the customer's question in the note) so the team actually follows up — never just redirect the customer to contact someone themselves.
   ⚠️ Numbers starting QT- / SO- / DN- are DOCUMENT numbers (quote / sales order / delivery note), NOT product SKUs — never search find_products for them; apply this rule immediately (own it + capture_lead with the doc number in the note).
   ⚠️ Acknowledge ONCE only — call capture_lead first, then reply after the tool result; never repeat the same sentence/meaning twice in one answer.
   💡 For quote/order status questions, also mention the customer can self-check anytime at "บัญชีของฉัน" https://www.jnac.online/account (log in with the e-mail they use with us).
6. Product details (price, stock, images) can be updated or corrected in the database at any time. Even if the conversation history shows that the customer complained about an incorrect image/price, or that a previous answer contained incorrect details, you MUST NOT assume the data remains incorrect, and you MUST NEVER reuse the stale details or image URLs from the history. You MUST always invoke the tool (find_products or get_product_detail) to query the latest database values and output the updated image URL/price from the tool response immediately.`;

const TOOLING_GUIDE_TH = `🛠️ กฎการใช้ TOOLS (สำคัญมาก — ต้องทำตาม)

1. ลูกค้าถามสินค้าเฉพาะ (มีชื่อ/รหัส/เบอร์) → เรียก find_products ทันที (ห้ามตอบว่า ไม่พบ ก่อนเรียก tool) — ยกเว้นเลข QT-/SO-/DN- ซึ่งเป็นเลขเอกสาร ให้ใช้ SAFETY ข้อ 5
2. คำถามกว้างๆ → เรียก list_product_groups หรือ list_categories ก่อน
3. ถ้าพูดว่า เดี๋ยวเช็คให้ → ต้อง CALL TOOL จริงใน reply เดียวกัน

🚫 ห้ามเสนอสินค้าเพียงเพราะขนาด เบอร์ หรือการใช้งานใกล้เคียงกัน หากเป็นคนละชนิดสินค้า. เมื่อไม่มีตัวเลือกที่ผ่านเงื่อนไข ให้บอกว่าจะตรวจสอบจัดหา/สั่งผลิตกับคุณเชอร์รี่ แทนการเดาสินค้าทดแทน

4. Tool คืน 0 ผล + ไม่มี clarification_candidates → ห้ามบอกว่า ไม่มี/ไม่พบ ให้บอกว่าขอให้คุณเชอร์รี่ตรวจสอบว่าสั่งผลิต/จัดหาได้ไหม แล้วแจ้งกลับ
5. ⚠️ ทุกครั้งที่เสนอตัวเลือกสินค้า, สินค้าทดแทน, สินค้าใกล้เคียง หรือรายการเบอร์/ขนาด/สเป็กสินค้าใดๆ ให้ลูกค้าเลือก (รวมถึงกรณีเสนอนำเสนอตัวเลือกเพื่อสั่งผลิต/สั่งซื้อ): ต้องจัดรูปแบบเป็นรายการลำดับตัวเลข "1.", "2.", "3." เสมอ (ห้ามใช้สัญลักษณ์หรืออีโมจิอื่นๆ เช่น ✨ หรือ • นำหน้าชื่อตัวเลือกเด็ดขาด) เพื่อให้หมายเลขตรงกับปุ่มกด Quick Reply
6. เจอสินค้าแต่ in_stock=false → เสนอสั่งผลิตเสมอ ไม่ใช่ตอบแค่ หมด
7. query: ใส่เฉพาะตัวระบุสินค้า (ชื่อ/SKU/ขนาด)
8. 🔒 กฎสินค้าทดแทน (ห้ามฝ่าฝืน):
   - เสนอสินค้าได้เฉพาะผลจาก tool ที่มี safe_alternative=true เท่านั้น
   - ถ้า tool ส่ง requested_product_family มา: เสนอได้เฉพาะ product_family เดียวกันเท่านั้น แม้ขนาด/เบอร์ใกล้เคียงก็ห้ามข้ามชนิด เช่น "ผ้าทรายสายพาน" ห้ามเสนอ "ล้อทรายมีแกน" เด็ดขาด
   - ถ้า tool ส่ง requested_product_type มา (เช่น จานทราย, ล้อทราย, ผ้าทรายม้วน): ให้ถือเป็น hard gate ก่อนดูขนาด/เบอร์/คะแนน และเสนอได้เฉพาะ product_type เดียวกันเท่านั้น ห้ามข้ามคำระบุชนิดสินค้านี้เด็ดขาด
   - ถ้าไม่มี requested_product_family: เสนอได้เฉพาะ safe_name_score ตั้งแต่ 0.70 ขึ้นไป
   - safe_name_score / safe_match_basis เป็นค่าจาก tool เท่านั้น ห้ามคำนวณหรือเดาเอง
   - หากไม่มีตัวเลือก safe_alternative: ห้ามแสดงชื่อสินค้าอื่น ให้ capture_lead เพื่อให้ทีมตรวจสอบจัดหา/สั่งผลิต และต้องระบุ requested_product_type ในคำตอบเพื่อยืนยันว่ากำลังตรวจสอบสินค้าชนิดที่ลูกค้าถาม
   - สินค้าที่เป็น same_family แต่ขนาด/เบอร์ไม่ตรง เป็น "ทางเลือก" เท่านั้น: ต้องบอกความต่างให้ชัด และห้ามสร้างใบเสนอราคาจนกว่าลูกค้าจะยืนยัน SKU/ขนาดนั้น

📷 ถ้าลูกค้าส่งรูปภาพใดๆ มา (ไม่ว่าจะส่งเป็นไฟล์รูปภาพ เอกสาร หรือแคปหน้าจอมา) → ให้ตีความวัตถุประสงค์ของรูปภาพนั้นก่อนเป็นอันดับแรก:
- หากตีความได้ว่าเป็น "ใบสั่งซื้อ / PO / เอกสารสั่งซื้อ / สรุปสั่งของ": ห้ามเสนอสินค้าใกล้เคียงหรือทางเลือกอื่นเด็ดขาด! ให้รับเรื่องโดยแจ้งว่าส่งต่อเอกสารให้ทีมงานจัดการต่อแล้ว (ไม่ต้องทวนรายการหรือจำนวนในใบสั่งซื้อ) และเรียก capture_lead (บันทึกรายละเอียดใบสั่งซื้อใน note) เพื่อส่งเรื่องให้ทีมงาน. ห้ามใช้ชื่อสินค้าจากประวัติแชตเก่ามาตีความแทนรายการในเอกสาร
- หากตีความได้ว่าเป็น "สลิปโอนเงิน / สลิปแจ้งชำระเงิน": ห้ามแนะนำสินค้า ค้นหาสินค้า หรือเรียกใช้ tool ใดๆ ทั้งสิ้น และห้ามนำข้อมูลในสลิปมาเสนอขายต่อ ให้ตอบเพียงว่า "ขอบพระคุณค่ะ เอยส่งเรื่องให้ฝ่ายบัญชีตรวจสอบเรียบร้อยแล้วนะคะ" ห้ามระบุ/อ่าน/คาดเดายอดเงิน วันที่ เวลา เลขบัญชี ชื่อผู้โอน เลขอ้างอิง หรือยืนยันว่าชำระสำเร็จโดยเด็ดขาด แม้เห็นข้อมูลในภาพ
- หากเป็นรูปภาพอื่นๆ (เช่น รูปสินค้าจริง ชิ้นงานหน้างาน หรือตัวอย่างการใช้งานทั่วไป): ให้ดูรูปแล้วอธิบายสิ่งที่เห็นสั้นๆ และเรียก find_products เพื่อค้นหาสินค้าที่เกี่ยวข้องหรือใกล้เคียงเสนอให้ลูกค้า — ห้ามเดาราคา/สเป็กจากรูปเอง

📦 ช่องข้อมูลจาก tool: stock (0=หมด), in_stock, min_order_qty (จำนวนขั้นต่ำ ใช้ค่านี้เสมอ), unit
🧠 อ่านประวัติ: ทักทายแล้วห้ามทักซ้ำ; อันนั้น = สินค้าที่เพิ่งคุย
🖼️ รูปสินค้า: ใช้ image_thumb เป็น ![ชื่อ SKU](url)

🤝 เก็บ LEAD / ใบเสนอราคา (สำคัญมาก — โอกาสปิดการขาย)
• ลูกค้าสนใจซื้อจริง / ถามซื้อจำนวนมาก / ฝากเบอร์ / ขอให้ติดต่อกลับ / ถามสิ่งที่เอยตอบไม่ได้ → เรียก capture_lead ทันที
• ก่อนออกใบเสนอราคา ต้องมีลูกค้า CRM ที่ผูกด้วยเลขผู้เสียภาษี 13 หลักเสมอ ถ้า request_quote แจ้ง customer_details_required ให้ถามชื่อบริษัท ที่อยู่ออกบิล เลขผู้เสียภาษี 13 หลัก และสาขา (ถ้ามี) แล้วรอข้อมูล ห้ามบอกว่าสร้างใบเสนอราคาแล้ว
• เมื่อลูกค้าส่งข้อมูลออกบิลเป็นข้อความหรือรูปเอกสารที่อ่านชัด ให้เรียก link_quote_customer โดยคัดลอกข้อมูลตามจริง ห้ามเดาหรือเติมข้อมูลเอง เลขผู้เสียภาษีเป็นกุญแจเดียวที่ใช้ผูกลูกค้า
• ถ้ารูปเป็นหนังสือรับรอง/ภ.พ.20/นามบัตรที่ส่งมาเพื่อตอบคำถามข้อมูลออกบิล ไม่ถือเป็น PO และสามารถเรียก link_quote_customer ได้ เมื่อข้อมูลบังคับครบและอ่านชัด
• เรียก request_quote ได้เฉพาะเมื่อลูกค้าขอ "ออกใบเสนอราคา" โดยตรง และยืนยันสินค้า+จำนวนชัดเจนเท่านั้น → ใส่ SKU จริงจากผล find_products (ถ้ายังไม่รู้ SKU ให้ค้นก่อน)\n• ห้ามเรียก request_quote เมื่อเป็นคำขอบคุณ, คำถามวิธีสั่งสินค้า, หรือรูป/เอกสารที่ส่งมาอย่างเดียวเด็ดขาด — ให้ตอบตามเจตนาของลูกค้าแทน\n• หาก tool คืน quote_created=true เท่านั้น จึงแจ้งเลข quote_code ว่าเป็นใบที่เพิ่งสร้าง; ถ้า quote_reused=true ให้บอกว่าใช้ใบเดิมและห้ามสร้าง/อ้างว่าเกิดใบใหม่
• ถ้าลูกค้าไม่ระบุสินค้าแน่ชัด/หา SKU ไม่ได้ → ใช้ capture_lead แทน อย่าเดา SKU
• tool เหล่านี้ ไม่ได้ ส่งข้อความหาลูกค้า แค่บันทึกในระบบ+แจ้งทีมขาย JNAC ภายใน
• เรียก capture_lead แค่ครั้งเดียวต่อบทสนทนา
• ห้ามสัญญาราคาพิเศษ/ส่วนลดเองถ้าไม่มีข้อมูลจริง`;

const TOOLING_GUIDE_EN = `🛠️ TOOLING RULES (CRITICAL)
1. Specific product → call find_products FIRST. Never say not available before calling. (Exception: QT-/SO-/DN- numbers are document numbers — use SAFETY rule 5.)
2. Broad question → call list_product_groups / list_categories first.
3. If you say let me check → you MUST call a tool in the SAME reply.
🚫 NEVER offer a product merely because its size, grit, or use is similar when it is a different product type. If no safe option exists, escalate for sourcing/made-to-order instead of guessing a substitute.
4. 0 results + no candidates → offer made-to-order via Khun Cherry.
5. ⚠️ Whenever offering product options, alternatives, similar items, or lists of sizes/grits/specs for the customer to choose from (including made-to-order variant choices): You MUST present them as a numbered list starting with "1.", "2.", "3." (do NOT use emojis like ✨ or bullet points like • for these lists under any circumstances) so that the numbers align exactly with the Quick Reply buttons.
6. in_stock=false → offer made-to-order, never just out of stock.
7. query: pass ONLY product identifier.
8. 🔒 SUBSTITUTION GATE (non-negotiable):
   - Offer only tool results with safe_alternative=true.
   - When requested_product_family is provided, candidate product_family MUST match exactly. Never cross product types (for example sanding belt -> mounted flap wheel), even when dimensions or grit look similar.
   - When requested_product_type is provided (for example flap disc, mounted wheel, sanding roll), it is a hard gate before dimensions, grit, or scoring: candidate product_type MUST match exactly.
   - Without requested_product_family, only offer candidates with safe_name_score >= 0.70.
   - safe_name_score and safe_match_basis come from the tool; never estimate them yourself.
   - If no safe_alternative exists, do not list another product; call capture_lead for sourcing/made-to-order and explicitly name requested_product_type in the reply.
   - A same-family product with a different size/grit is an alternative only: state the difference and do not create a quote until the customer confirms that SKU/size.
📷 If the customer sends any IMAGE (whether uploaded as a photo, doc screenshot, or any file) → You must interpret the intent of the image first:
- If interpreted as a "Purchase Order / PO / order document / order summary": DO NOT suggest similar items or alternatives under any circumstances! Acknowledge receipt, state that you have forwarded the document to the team (do not list/repeat items or quantities), and call capture_lead (put the PO/order details in the note) to notify the sales team. Never use a product from old chat history as a substitute for the document contents.
- If interpreted as a "bank transfer slip / payment receipt": DO NOT recommend products, search products, or call any tools. Reply only with a generic accounting-review acknowledgement. Never state, extract, infer, or confirm an amount, date, time, account number, payer, reference, or payment success from the image.
- If it is any other image (e.g., product photo, physical workpiece, general usage example): Describe what you see briefly and call find_products to recommend matching or related products to the customer. Never invent price/specs from a photo.
📦 Fields: stock (0=oos), in_stock, min_order_qty (always use), unit.

🤝 CAPTURE LEADS / QUOTES (sales opportunity)
• Buying intent / bulk / leaves a phone / asks to be contacted / asks anything you cannot answer → call capture_lead.
• A quotation requires a CRM customer linked by an exact 13-digit tax ID. If request_quote returns customer_details_required, ask for legal company name, billing address, 13-digit tax ID, and branch (if any). Do not claim a quote exists yet.
• When the customer supplies readable billing details in text or a document image, call link_quote_customer with exact visible values. Never infer missing data. Tax ID is the only matching key.
• A certificate/VAT registration/business card sent specifically to answer the billing-data request is not a PO and may be processed with link_quote_customer when all required fields are legible.
• Call request_quote only for a DIRECT request to issue a quote with confirmed specific items+quantities. Never call it for a thank-you, an ordering-process question, or an image/document alone.\n• Tell the customer a newly created quote_code only when the tool returns quote_created=true. If quote_reused=true, use the existing draft and never claim that a new quote was created.
• Items unclear / SKU unresolved → capture_lead instead; never guess SKUs.
• These tools do NOT message the customer — they record in the system + notify the internal JNAC team.
• Call capture_lead only ONCE per conversation. Never promise special prices yourself.`;

function buildSystemPrompt(persona: string, contextText: string | null, lang: Lang, memory: ConversationMemory | null, guidance: LearningGuidance[]): string {
  const safety  = lang === "th" ? SAFETY_RULES_TH  : SAFETY_RULES_EN;
  const tooling = lang === "th" ? TOOLING_GUIDE_TH : TOOLING_GUIDE_EN;
  const ctx = contextText ? `\n\n[knowledge base context]\n${contextText}` : "";
  const learning = learningPromptContext(memory, guidance);
  const learningCtx = learning ? `\n\n[guarded learning context]\n${learning}` : "";
  return `${safety}\n\n==========\n👤 PERSONA\n==========\n${persona}\n\n==========\n${tooling}${ctx}${learningCtx}`;
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
  try {
    const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: "GEMINI_API_KEY" });
    if (!error && data) {
      cachedGeminiKey = String(data);
      return cachedGeminiKey;
    }
    if (error) console.warn("GEMINI_API_KEY RPC read failed:", error.message);
  } catch (e) {
    console.warn("GEMINI_API_KEY RPC error:", (e as Error).message);
  }
  const env = Deno.env.get("GEMINI_API_KEY");
  if (env) {
    cachedGeminiKey = env;
    return env;
  }
  return null;
}
async function getOpenAIKey(admin: SupabaseClient): Promise<string | null> {
  if (cachedOpenAIKey) return cachedOpenAIKey;
  try {
    const { data, error } = await admin.rpc("get_api_secret_internal", { p_name: "OPENAI_API_KEY" });
    if (!error && data) {
      cachedOpenAIKey = String(data);
      return cachedOpenAIKey;
    }
    if (error) console.warn("OPENAI_API_KEY RPC read failed:", error.message);
  } catch (e) {
    console.warn("OPENAI_API_KEY RPC error:", (e as Error).message);
  }
  const env = Deno.env.get("OPENAI_API_KEY");
  if (env) {
    cachedOpenAIKey = env;
    return env;
  }
  return null;
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
}

/** Best-effort, privacy-safe run telemetry. Raw prompts/responses and tool
 * arguments are deliberately excluded. Telemetry must never break a reply. */
async function recordAiRun(admin: SupabaseClient, input: {
  requestId: string;
  conversationId: string | null;
  channel: string;
  model: string;
  retrievalCount: number;
  topSimilarity: number | null;
  toolNames: string[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  elapsed: { embed: number; search: number; llm: number };
  totalMs: number;
  firstTokenMs: number | null;
  toolMs: number;
  toolIterations: number;
  edgeRegion: string | null;
  routingVariant: RoutingVariant;
  contentKind: "text" | "image";
  phaseTimings: Record<string, number>;
  outcome?: string;
  errorCode?: string | null;
}) {
  try {
    const { error } = await admin.from("chat_ai_runs").insert({
      request_id: input.requestId,
      conversation_id: input.conversationId,
      channel: input.channel,
      model: input.model,
      embedding_model: OPENAI_EMBED_MODEL,
      embedding_version: "openai-1536-v1",
      retrieval_count: input.retrievalCount,
      top_similarity: input.topSimilarity,
      tool_names: [...new Set(input.toolNames)].slice(0, 20),
      prompt_tokens: input.usage.prompt_tokens,
      completion_tokens: input.usage.completion_tokens,
      total_tokens: input.usage.total_tokens,
      embed_ms: input.elapsed.embed,
      search_ms: input.elapsed.search,
      llm_ms: input.elapsed.llm,
      total_ms: input.totalMs,
      first_token_ms: input.firstTokenMs,
      tool_ms: input.toolMs,
      tool_iterations: input.toolIterations,
      edge_region: input.edgeRegion,
      routing_variant: input.routingVariant,
      content_kind: input.contentKind,
      phase_timings: input.phaseTimings,
      outcome: input.outcome ?? "ok",
      error_code: input.errorCode ?? null,
    });
    if (error) {
      console.warn("chat_ai_runs insert failed:", { code: error.code, message: error.message });
    }
  } catch (e) {
    console.warn("chat_ai_runs insert failed:", (e as Error).message);
  }
}

function zeroTokens() { return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; }
function zeroElapsed() { return { embed: 0, search: 0, llm: 0 }; }

function classifyAiError(error: unknown): string {
  const message = String((error as Error)?.message ?? error);
  if (/429|rate.?limit/i.test(message)) return "rate_limited";
  if (/503|UNAVAILABLE/i.test(message)) return "unavailable";
  if (/key missing|configuration/i.test(message)) return "configuration";
  return "unknown";
}

function recordFailedAiRun(
  admin: SupabaseClient,
  telemetry: RequestTelemetry,
  conversationId: string | null,
  channel: string,
  error: unknown,
): void {
  runInBackground("chat_ai_runs_error", recordAiRun(admin, {
    requestId: telemetry.requestId,
    conversationId,
    channel,
    model: "error",
    retrievalCount: 0,
    topSimilarity: null,
    toolNames: [],
    usage: zeroTokens(),
    elapsed: zeroElapsed(),
    totalMs: Date.now() - telemetry.startedAt,
    firstTokenMs: null,
    toolMs: 0,
    toolIterations: 0,
    edgeRegion: telemetry.edgeRegion,
    routingVariant: telemetry.routingVariant,
    contentKind: telemetry.contentKind,
    phaseTimings: {},
    outcome: "error",
    errorCode: classifyAiError(error),
  }));
}

function isInternalServiceCall(req: Request, serviceKey: string): boolean {
  return req.headers.get("authorization") === `Bearer ${serviceKey}`;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const PAYMENT_RECEIPT_ACK_TH = "ขอบพระคุณค่ะ 🙏 เอยส่งเรื่องให้ฝ่ายบัญชีตรวจสอบเรียบร้อยแล้วนะคะ 😊";
const PAYMENT_RECEIPT_ACK_EN = "Thank you. Our accounting team will review the payment notification shortly. 😊";
const PAYMENT_RECEIPT_REPLY_RE = /(?:สลิป(?:โอนเงิน|แจ้งชำระเงิน)?|แจ้งโอนเงิน|ฝ่ายบัญชี.*ตรวจสอบ(?:ยอด|การชำระ)|ตรวจสอบ(?:ยอด|การโอน)|payment\s*(?:receipt|slip)|bank\s*transfer\s*slip|accounting.*(?:verify|review))/iu;
const PAYMENT_RECEIPT_QUERY_RE = /(?:สลิป|แจ้งโอน|โอนเงินแล้ว|ส่งหลักฐาน(?:การ)?ชำระ|payment\s*(?:receipt|slip)|bank\s*transfer\s*(?:receipt|slip|sent))/iu;

function sanitizePaymentReceiptAnswer(query: string, images: ImagePart[], answer: string, lang: Lang): string {
  const receiptContext = images.length > 0 || PAYMENT_RECEIPT_QUERY_RE.test(query);
  if (receiptContext && PAYMENT_RECEIPT_REPLY_RE.test(answer)) {
    return lang === "th" ? PAYMENT_RECEIPT_ACK_TH : PAYMENT_RECEIPT_ACK_EN;
  }
  return answer;
}

Deno.serve(async (req: Request) => {
  const requestStartedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const internalServiceCall = isInternalServiceCall(req, serviceKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: MSG.th.invalidJson + " / " + MSG.en.invalidJson }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const rawQuery = String(body.query ?? "").trim();
  if (rawQuery.length > MAX_QUERY_CHARS) {
    return new Response(JSON.stringify({ error: "ข้อความยาวเกิน 4,000 ตัวอักษร / Message exceeds 4,000 characters" }), { status: 413, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
  const query = rawQuery;
  const images = normalizeImages(body.images);
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_HISTORY_ITEMS)
    .map((item: unknown) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        role: row.role === "assistant" ? "assistant" : "user",
        content: String(row.content ?? "").slice(0, MAX_HISTORY_CHARS),
      };
    });
  const match_count = Math.max(1, Math.min(MAX_CONTEXT_CHUNKS, Number(body.match_count ?? DEFAULT_MATCH_COUNT) || DEFAULT_MATCH_COUNT));
  const matchThreshold = Math.max(0, Math.min(1, Number(body.match_threshold ?? DEFAULT_MATCH_THRESHOLD) || DEFAULT_MATCH_THRESHOLD));
  const wantStream = body.stream !== false;
  const sessionId = typeof body.session_id === "string" && body.session_id.length >= 8 ? body.session_id : null;
  const displayName = typeof body.display_name === "string" ? body.display_name : "";
  const channelRaw = typeof body.channel === "string" ? body.channel.toLowerCase() : "default";
  const channel = ALLOWED_CHANNELS.has(channelRaw) ? channelRaw : "default";
  const lang = resolveResponseLanguage(query, history, channel);
  const requestId = internalServiceCall && isUuid(body.request_id)
    ? body.request_id
    : crypto.randomUUID();
  const routingVariantRaw = internalServiceCall ? String(body.routing_variant ?? "direct") : "direct";
  const routingVariant: RoutingVariant = routingVariantRaw === "auto" || routingVariantRaw === "db_region"
    ? routingVariantRaw
    : "direct";
  const telemetry: RequestTelemetry = {
    requestId,
    startedAt: requestStartedAt,
    edgeRegion: Deno.env.get("SB_REGION") ?? Deno.env.get("DENO_REGION") ?? null,
    routingVariant,
    contentKind: images.length > 0 ? "image" : "text",
  };

  if (!query && images.length === 0) return new Response(JSON.stringify({ error: MSG[lang].queryRequired }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  // Only a service-role caller (the LINE webhook) may attach an existing
  // conversation. Browser callers can create/read only their own livechat
  // conversation via the session id, so they cannot probe another customer's
  // continuity memory.
  const internalConversationId = internalServiceCall && isUuid(body.conversation_id)
    ? body.conversation_id
    : null;
  let conversationId: string | null = internalConversationId;
  const persistMessages = !internalConversationId;
  if (!conversationId && sessionId) conversationId = await upsertLivechatConversation(admin, sessionId, displayName);
  if (conversationId && persistMessages) {
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
        try { await handleQuery(admin, query, images, history, match_count, matchThreshold, lang, channel, conversationId, persistMessages, telemetry, send); }
        catch (e) {
          const msg = (e as Error).message ?? String(e);
          const friendly = /503|UNAVAILABLE|429/.test(msg) ? MSG[lang].aiBusy : msg;
          send({ type: "error", message: friendly });
          recordFailedAiRun(admin, telemetry, conversationId, channel, e);
        } finally { try { controller.close(); } catch (_e) { /* ignore */ } }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "Connection": "keep-alive", ...CORS_HEADERS } });
  }

  const events: Array<Record<string, unknown>> = [];
  try { await handleQuery(admin, query, images, history, match_count, matchThreshold, lang, channel, conversationId, persistMessages, telemetry, (e) => events.push(e)); }
  catch (e) {
    const msg = (e as Error).message ?? String(e);
    const friendly = /503|UNAVAILABLE|429/.test(msg) ? MSG[lang].aiBusy : msg;
    events.push({ type: "error", message: friendly });
    recordFailedAiRun(admin, telemetry, conversationId, channel, e);
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
    request_id: (done as Record<string, unknown>).request_id ?? requestId,
    conversation_id: conversationId,
    channel,
    clarification_candidates,
    paused: pausedEv ? (pausedEv as Record<string, unknown>).reason : undefined,
    blocked: blockedAnswer ? "cost_query" : undefined,
    error: errEv ? (errEv.message as string) : undefined,
  }), { status: errEv ? 500 : 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
});

async function handleQuery(admin: SupabaseClient, query: string, images: ImagePart[], history: Array<{ role: string; content: string }>, match_count: number, matchThreshold: number, lang: Lang, channel: string, conversationId: string | null, persistMessages: boolean, telemetry: RequestTelemetry, send: (event: Record<string, unknown>) => void) {
  const botFlagsStartedAt = Date.now();
  const [globalOn, channelOn, convOn] = await Promise.all([
    isGlobalBotEnabled(admin),
    isChannelBotEnabled(admin, channel),
    conversationId ? isConversationBotEnabled(admin, conversationId) : Promise.resolve(true),
  ]);
  const botFlagsMs = Date.now() - botFlagsStartedAt;
  const scheduleSimpleRun = (
    model: string,
    outcome: string,
    firstTokenMs: number | null,
    toolNames: string[] = [],
    toolMs = 0,
    toolIterations = 0,
  ) => {
    const totalMs = Date.now() - telemetry.startedAt;
    runInBackground("chat_ai_runs", recordAiRun(admin, {
      requestId: telemetry.requestId,
      conversationId,
      channel,
      model,
      retrievalCount: 0,
      topSimilarity: null,
      toolNames,
      usage: zeroTokens(),
      elapsed: zeroElapsed(),
      totalMs,
      firstTokenMs,
      toolMs,
      toolIterations,
      edgeRegion: telemetry.edgeRegion,
      routingVariant: telemetry.routingVariant,
      contentKind: telemetry.contentKind,
      phaseTimings: { bot_flags_ms: botFlagsMs },
      outcome,
    }));
  };
  if (!globalOn || !channelOn || !convOn) {
    const reason = !globalOn ? "global" : !channelOn ? "channel" : "conversation";
    send({ type: "paused", reason });
    send({ type: "done", sources: [], tokens: zeroTokens(), elapsed_ms: zeroElapsed(), model: `paused:${reason}`, tool_calls: [], request_id: telemetry.requestId, conversation_id: conversationId, channel });
    scheduleSimpleRun(`paused:${reason}`, "paused", null);
    return;
  }

  if (isCostQuery(query)) {
    const refusal = MSG[lang].costRefusal;
    const firstTokenMs = Date.now() - telemetry.startedAt;
    send({ type: "blocked", reason: "cost_query", answer: refusal });
    if (conversationId && persistMessages) await saveMessage(admin, conversationId, "bot", refusal, { blocked: "cost_query" });
    send({ type: "done", sources: [], tokens: zeroTokens(), elapsed_ms: zeroElapsed(), model: "guardrail", tool_calls: [], request_id: telemetry.requestId, conversation_id: conversationId, channel });
    scheduleSimpleRun("guardrail", "cost_query", firstTokenMs);
    return;
  }

  // A callback request is an operational commitment, not an LLM judgement.
  // Create the follow-up task deterministically so a friendly acknowledgement
  // can never be sent without notifying the sales team.
  if (query && images.length === 0 && isCallbackRequest(query)) {
    const toolStartedAt = Date.now();
    const args = { interest: lang === "th" ? "ขอให้ติดต่อกลับ" : "callback request", note: query };
    const result = await captureLead(admin, args, channel, conversationId);
    const toolMs = Date.now() - toolStartedAt;
    const answer = lang === "th"
      ? "เอยรับเรื่องให้ทีมงานติดต่อกลับแล้วนะคะ 😊"
      : "I have asked our team to contact you back shortly. 😊";
    const toolCalls = [{ name: "capture_lead", args, result_summary: JSON.stringify(result).slice(0, 200) }];
    send({ type: "tool_call", name: "capture_lead", args });
    const firstTokenMs = Date.now() - telemetry.startedAt;
    send({ type: "text", chunk: answer });
    if (conversationId && persistMessages) await saveMessage(admin, conversationId, "bot", answer, { tool_calls: [{ name: "capture_lead", args }] });
    send({ type: "done", sources: [], tokens: zeroTokens(), elapsed_ms: zeroElapsed(), model: "guardrail:callback_lead", tool_calls: toolCalls, request_id: telemetry.requestId, conversation_id: conversationId, channel });
    scheduleSimpleRun("guardrail:callback_lead", "callback_lead", firstTokenMs, ["capture_lead"], toolMs, 1);
    return;
  }

  const setupStartedAt = Date.now();
  const learningSettings = await getLearningSettings(admin);
  const [geminiKey, openaiKey, persona, conversationMemory, approvedGuidance] = await Promise.all([
    getGeminiKey(admin),
    getOpenAIKey(admin),
    getPersonaPrompt(admin, channel),
    loadConversationMemory(admin, conversationId, learningSettings),
    loadApprovedLearningGuidance(admin, query, learningSettings),
  ]);
  const setupMs = Date.now() - setupStartedAt;
  if (!geminiKey) throw new Error(MSG[lang].geminiKeyMissing);
  if (!openaiKey) throw new Error(MSG[lang].openaiKeyMissing);

  send({ type: "status", message: "thinking", channel });
  let embed_ms = 0;
  let search_ms = 0;
  let matchedRows: Array<{ id: string; content: string; metadata: unknown; similarity: number; source_path: string; tags: string[]; title: string | null }> = [];
  let expandedRows: Array<{ source_path: string; chunk_index: number; title: string | null; content: string }> = [];
  let forcedRows: Array<{ source_path: string; chunk_index: number; title: string | null; content: string }> = [];
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

    // ── Forced retrieval for payment / bank-account queries ────────────────
    // RAG embedding similarity may be low for short queries like "ขอเลขบัญชี".
    // If the query is clearly about payment, always inject the payment KB doc.
    const PAYMENT_RE = /เลขบัญชี|บัญชีธนาคาร|โอนเงิน|ชำระเงิน|ช่องทางชำระ|qr\s*code|qr/i;
    if (query && PAYMENT_RE.test(query)) {
      const paymentAlreadyLoaded = expandedRows.some(
        (r) => /บัญชี|payment|ชำระ|โอน/i.test(r.source_path)
      );
      if (!paymentAlreadyLoaded) {
        const { data: paymentDocs } = await admin
          .from("knowledge_chunks")
          .select("source_path, chunk_index, title, content")
          .ilike("source_path", "%บัญชี%")
          .eq("visibility", "public")
          .order("chunk_index", { ascending: true });
        if (paymentDocs && paymentDocs.length > 0) {
          expandedRows = [...paymentDocs, ...expandedRows].slice(0, MAX_CONTEXT_CHUNKS);
        }
      }
    }
    // ── End forced retrieval ───────────────────────────────────────────────

    // ── Forced retrieval for location / map / address queries ─────────────
    // Short or misspelled Thai queries can fall below the vector threshold
    // (for example "ขอโลเคชั้น"). Always inject the approved public location
    // document when the intent is unambiguous.
    if (query && LOCATION_RE.test(query)) {
      const locationAlreadyLoaded = expandedRows.some(
        (r) => /location|แผนที่|ที่ตั้ง|ที่อยู่/i.test(r.source_path)
      );
      if (!locationAlreadyLoaded) {
        const { data: locationDocs, error: locationErr } = await admin
          .from("knowledge_chunks")
          .select("source_path, chunk_index, title, content")
          .or("source_path.ilike.%location%,source_path.ilike.%แผนที่%")
          .eq("visibility", "public")
          .order("source_path", { ascending: true })
          .order("chunk_index", { ascending: true });
        if (locationErr) throw locationErr;
        if (locationDocs && locationDocs.length > 0) {
          forcedRows = locationDocs;
          expandedRows = [...locationDocs, ...expandedRows].slice(0, MAX_CONTEXT_CHUNKS);
        }
      }
    }
    // ── End forced location retrieval ─────────────────────────────────────

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

  const systemPrompt = buildSystemPrompt(persona, contextText, lang, conversationMemory, approvedGuidance);
  const generationStartedAt = Date.now();
  const defaultImgPrompt = lang === "en"
    ? "The customer sent this image. Please inspect it according to image rules."
    : "ลูกค้าส่งรูปภาพนี้มา ช่วยตรวจสอบตามกฎการจัดการรูปภาพ";
  const userParts: Array<Record<string, unknown>> = [{ text: query || defaultImgPrompt }];
  for (const im of images) userParts.push({ inlineData: { mimeType: im.mimeType, data: im.data } });
  const contents: unknown[] = [
    ...history.map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.content }] })),
    { role: "user", parts: userParts },
  ];
  const usage = zeroTokens();
  const allToolCalls: Array<{ name: string; args: Record<string, unknown>; result_summary?: string }> = [];
  let usedModel = GEMINI_MODELS[0];
  let fullAnswer = "";
  let firstTokenMs: number | null = null;
  let llm_ms = 0;
  let tool_ms = 0;
  let toolIterations = 0;
  // Image replies are buffered so a payment receipt can be sanitized before a
  // single streamed token reaches any channel. Text payment notifications use
  // the same path for consistent privacy protection.
  const deferTextForPaymentSafety = images.length > 0 || PAYMENT_RECEIPT_QUERY_RE.test(query);
  const appendAnswer = (chunk: string) => {
    if (chunk && firstTokenMs === null) firstTokenMs = Date.now() - telemetry.startedAt;
    fullAnswer += chunk;
    if (!deferTextForPaymentSafety) send({ type: "text", chunk });
  };

  // Post-tool iterations are buffered (not streamed live) so a repeated
  // acknowledgment — the model loves to re-say "เดี๋ยวเอยขอตรวจสอบ..." after
  // the tool result — can be dropped instead of reaching the customer twice.
  const normText = (s: string) => s.replace(/\s+/g, "").replace(/[.,!?;:()\[\]"'`~\-—·]/g, "");
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    let iterText = "";
    const llmStartedAt = Date.now();
    const r = await streamGeminiWithFallback(geminiKey, systemPrompt, contents, (chunk) => {
      if (chunk && firstTokenMs === null) firstTokenMs = Date.now() - telemetry.startedAt;
      if (iter === 0) {
        appendAnswer(chunk);
      } else {
        iterText += chunk;
      }
    });
    llm_ms += Date.now() - llmStartedAt;
    if (iter > 0 && iterText) {
      const a = normText(fullAnswer);
      const b = normText(iterText);
      const duplicate = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
      if (!duplicate) {
        const sepNeeded = fullAnswer.trim() && !fullAnswer.endsWith("\n");
        const chunkOut = (sepNeeded ? "\n" : "") + iterText;
        appendAnswer(chunkOut);
      }
    }
    usedModel = r.model;
    usage.prompt_tokens += r.usage.prompt_tokens;
    usage.completion_tokens += r.usage.completion_tokens;
    usage.total_tokens += r.usage.total_tokens;
    if (r.toolCalls.length === 0) break;
    toolIterations += 1;
    contents.push({ role: "model", parts: r.allParts });
    for (const tc of r.toolCalls) { send({ type: "tool_call", name: tc.name, args: tc.args }); }
    const toolsStartedAt = Date.now();
    const responseParts = await Promise.all(
      r.toolCalls.map(async (call) => {
        const result = await dispatchTool(admin, call.name, call.args, send, channel, conversationId, query, images.length > 0);
        allToolCalls.push({ name: call.name, args: call.args, result_summary: JSON.stringify(result).slice(0, 200) });
        return { functionResponse: { name: call.name, response: result } };
      }),
    );
    tool_ms += Date.now() - toolsStartedAt;
    contents.push({ role: "user", parts: responseParts });
    if (iter === MAX_TOOL_ITERATIONS - 1) {
      const msgText = MSG[lang].maxIterations;
      appendAnswer(msgText);
    }
  }

  fullAnswer = sanitizePaymentReceiptAnswer(query, images, fullAnswer, lang);
  if (deferTextForPaymentSafety && fullAnswer) send({ type: "text", chunk: fullAnswer });

  const generationMs = Date.now() - generationStartedAt;
  const sources = [
    ...matchedRows.map((m) => ({ id: m.id, title: m.title, source_path: m.source_path, similarity: m.similarity, tags: m.tags ?? [], content_preview: m.content.slice(0, 200) })),
    ...forcedRows.map((r) => ({ id: `forced:${r.source_path}:${r.chunk_index}`, title: r.title, source_path: r.source_path, similarity: null, tags: [], content_preview: r.content.slice(0, 200) })),
  ];
  const elapsed = { embed: embed_ms, search: search_ms, llm: llm_ms };
  const toolNames = allToolCalls.map((t) => t.name);
  const responseCriticalWrites: Promise<unknown>[] = [
    // Keep this write on the response path. Moving a last-write-wins memory
    // upsert to waitUntil widens the chance that an older concurrent turn
    // overwrites the newer customer context.
    saveConversationMemory(admin, conversationId, channel, query, toolNames, learningSettings),
  ];
  if (conversationId && fullAnswer.trim() && persistMessages) {
    responseCriticalWrites.push(saveMessage(admin, conversationId, "bot", fullAnswer, {
      model: usedModel, channel,
      tool_calls: allToolCalls.map((t) => ({ name: t.name, args: t.args })),
      tokens: usage,
    }));
  }
  await Promise.all(responseCriticalWrites);
  const totalMs = Date.now() - telemetry.startedAt;
  send({ type: "done", sources, tokens: usage, elapsed_ms: elapsed, model: usedModel, tool_calls: allToolCalls, request_id: telemetry.requestId, conversation_id: conversationId, channel });
  runInBackground("post_reply", Promise.all([
    recordAiRun(admin, {
      requestId: telemetry.requestId,
      conversationId,
      channel,
      model: usedModel,
      retrievalCount: matchedRows.length + forcedRows.length,
      topSimilarity: matchedRows.length > 0 ? Number(matchedRows[0].similarity ?? 0) : null,
      toolNames,
      usage,
      elapsed,
      totalMs,
      firstTokenMs,
      toolMs: tool_ms,
      toolIterations,
      edgeRegion: telemetry.edgeRegion,
      routingVariant: telemetry.routingVariant,
      contentKind: telemetry.contentKind,
      phaseTimings: {
        bot_flags_ms: botFlagsMs,
        setup_ms: setupMs,
        embed_ms,
        search_ms,
        llm_ms,
        tool_ms,
        generation_ms: generationMs,
      },
    }),
    recordLearningCandidate(admin, {
      conversationId,
      channel,
      query,
      sourceCount: matchedRows.length + forcedRows.length,
      toolNames,
      settings: learningSettings,
    }),
  ]));
}
