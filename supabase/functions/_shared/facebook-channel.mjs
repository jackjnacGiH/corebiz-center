// Pure helpers shared by the Facebook webhook and its Node tests.
import { isSuccessfulExactPriceResult } from "./price-answer-guard.mjs";
export function pageEvents(payload, expectedPageId) {
  if (payload?.object !== "page" || !Array.isArray(payload.entry)) return [];
  const events = [];
  for (const entry of payload.entry) {
    if (String(entry?.id ?? "") !== expectedPageId) continue;
    for (const item of entry.messaging ?? []) {
      const senderId = String(item?.sender?.id ?? "");
      const message = item?.message;
      if (!senderId || senderId === expectedPageId || !message || message.is_echo) continue;
      const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null;
      const attachmentUrl = String(attachment?.payload?.url ?? "");
      const mediaUrl = /^https:\/\//iu.test(attachmentUrl) ? attachmentUrl : "";
      const contentType = attachment?.type === "image" ? "image"
        : attachment?.type === "file" || attachment?.type === "audio" || attachment?.type === "video" ? "file"
        : attachment ? "sticker" : undefined;
      const messageText = String(message.quick_reply?.payload || message.text || "").trim();
      const mediaText = contentType === "image" && mediaUrl ? `![image](${mediaUrl})`
        : mediaUrl || (contentType === "image" ? "[ลูกค้าส่งรูปภาพ]" : contentType === "file" ? "[ลูกค้าส่งไฟล์]" : "[ลูกค้าส่งสติกเกอร์]");
      const text = [messageText, attachment ? mediaText : ""].filter(Boolean).join("\n");
      const messageId = String(message.mid ?? "");
      if (messageId && text) events.push({ kind: "message", senderId, messageId, text,
        ...(contentType ? { contentType, attachmentUrl: mediaUrl } : {}) });
    }
    for (const change of entry.changes ?? []) {
      const value = change?.value;
      if (change?.field !== "feed" || value?.item !== "comment" || value?.verb !== "add") continue;
      const commentId = String(value.comment_id ?? "");
      const authorId = String(value.from?.id ?? "");
      const text = String(value.message ?? "").trim();
      if (commentId && text && authorId && authorId !== expectedPageId) {
        events.push({ kind: "comment", commentId, postId: String(value.post_id ?? ""), text, authorId });
      }
    }
  }
  return events;
}

const PRIVATE_CONTEXT_RE = /(?:\bQT-\d+\b|\bSO-\d+\b|\bDN-\d+\b|เลข(?:บัญชี|ผู้เสียภาษี)|สลิป|โอนเงิน|ชำระเงิน|ที่อยู่|เบอร์โทร|โทรศัพท์|ใบเสนอราคา|ใบสั่งซื้อ|สถานะ(?:คำสั่งซื้อ|จัดส่ง)|\b(?:invoice|quotation|payment|bank account|tax id|address|phone)\b)/iu;
const TEST_REPLY_RE = /(?:โหมดทดสอบ|read.only evaluation|read.only request|ไม่ได้สร้างงานจริง)/iu;

export function shouldAnswerCommentPublicly(text) {
  return Boolean(text.trim()) && !PRIVATE_CONTEXT_RE.test(text);
}

export function cleanPublicCommentAnswer(answer) {
  const withoutPrivateFollowUp = String(answer ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(?:ให้เอย|สนใจให้เอย).{0,50}ใบเสนอราคา.*$/iu, "").trim())
    .filter((line) => !/(?:^\s*\d+[.)]\s*(?:ต้องการใบเสนอราคา|ไม่ต้องการ(?:ใบเสนอราคา)?|request a quotation|no quotation)|^\s*(?:ต้องการใบเสนอราคา|ไม่ต้องการ(?:ใบเสนอราคา)?|request a quotation|no quotation))/iu.test(line))
    .join("\n");
  const text = withoutPrivateFollowUp
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$2")
    .replace(/\*\*/g, "")
    .trim();
  if (!text || TEST_REPLY_RE.test(text) || PRIVATE_CONTEXT_RE.test(text)) return null;
  return text.slice(0, 1_800);
}

function claimedPriceAmounts(text) {
  const amount = String.raw`\d[\d,]*(?:\.\d+)?`;
  const patterns = [
    new RegExp(String.raw`(?:฿|\bTHB\b)\s*(${amount})`, "giu"),
    new RegExp(String.raw`(${amount})\s*(?:บาท|\bTHB\b|฿|ต่อ(?:ชิ้น|แพ็ก|กล่อง|ชุด)|\/\s*(?:ชิ้น|แพ็ก|กล่อง|ชุด|pc|piece|unit)|per\s+(?:piece|pc|unit))`, "giu"),
    new RegExp(String.raw`(?:ราคา|ชิ้นละ|ยอดรวม|รวมเป็นเงิน|\b(?:unit\s+price|price|cost|total)\b)[^\d\n]{0,20}(${amount})`, "giu"),
  ];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)]
    .map((match) => Number(match[1].replaceAll(",", ""))));
}

function verifiedPriceCall(call) {
  let price;
  try { price = JSON.parse(String(call?.result_summary ?? "")); } catch { return null; }
  if (!isSuccessfulExactPriceResult(price)) return null;
  if (String(call?.args?.sku ?? "").trim().toUpperCase() !== String(price.sku).trim().toUpperCase()
    || Number(call?.args?.qty) !== Number(price.quantity)) return null;
  return price;
}

export function hasPublicEvidence(result, answer = "") {
  const calls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
  const catalogVerified = calls.some((call) =>
    ["find_products", "get_product_detail"].includes(String(call?.name))
    && ["resolved", "needs_selection"].includes(String(call?.result_meta?.disposition)));
  const text = String(answer);
  const claimsPrice = /(?:\b(?:THB|USD|EUR|GBP)\b|[฿$€£]|\d[\d,.]*\s*บาท|(?:ราคา|ชิ้นละ|price|cost)[^\d\n]{0,20}\d[\d,.]*|\d[\d,.]*\s*(?:ต่อ(?:ชิ้น|แพ็ก|กล่อง|ชุด)|\/\s*(?:ชิ้น|แพ็ก|กล่อง|ชุด|pc|piece|unit)|per\s+(?:piece|pc|unit)))/iu.test(text);
  if (claimsPrice) {
    if (!catalogVerified || /(?:\b(?:USD|EUR|GBP)\b|[$€£])/iu.test(text)) return false;
    const priceCalls = calls.filter((call) => call?.name === "get_exact_price");
    const prices = priceCalls.map(verifiedPriceCall);
    const claimed = claimedPriceAmounts(text);
    return prices.length > 0 && prices.every(Boolean) && claimed.length > 0
      && claimed.every((amount) => prices.some((price) =>
        Math.abs(amount - price.unit_price) < 0.005 || Math.abs(amount - price.line_total) < 0.005));
  }
  const claimsProductFact = /(?:\bSKU\b|สต็อก|พร้อมส่ง|สินค้าสั่งผลิต|กระดาษทราย|จานทราย|ใบตัด|ใบเจียร|แผ่นขัด|แปรงลวด|ลูกขัด|เครื่องมือ|\b(?:abrasive|sandpaper|grinding\s+disc|cutting\s+disc|in\s+stock|made\s+to\s+order)\b|\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b|#\s*\d{2,5}|\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม\.?|cm|ซม\.?))/iu.test(text);
  return catalogVerified || (!claimsProductFact && Array.isArray(result?.sources) && result.sources.length > 0);
}

function quickReplyTitle(number, option) {
  const full = `${number}. ${option}`;
  if (full.length <= 20) return full;
  const model = option.match(/\b[A-Z]{1,}[A-Z0-9-]{2,}\b/u)?.[0] ?? "";
  const size = option.match(/\b\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม\.?)/iu)?.[0] ?? "";
  const grit = option.match(/#\s*\d{1,5}[A-Z]?\b/iu)?.[0] ?? "";
  const distinctive = [model, size, grit].filter(Boolean).join(" ");
  if (distinctive) return `${number}. ${distinctive}`.slice(0, 20);
  return `${number}. ${option.slice(-(20 - String(number).length - 2))}`;
}

export function messengerQuickReplies(text) {
  const rows = String(text ?? "").split(/\r?\n/);
  const found = [];
  for (const row of rows) {
    const match = row.match(/^\s*(\d{1,2})[.)]\s+(.+)$/u);
    if (!match || Number(match[1]) !== found.length + 1) continue;
    const option = match[2].trim();
    if (!option || option.length > 1_000) continue;
    const title = quickReplyTitle(match[1], option);
    found.push({ content_type: "text", title, payload: option });
    if (found.length >= 13) break;
  }
  return found;
}
