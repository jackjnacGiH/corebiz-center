// Pure helpers shared by the Facebook webhook and its Node tests.
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
        events.push({ kind: "comment", commentId, postId: String(value.post_id ?? ""), text });
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

export function hasPublicEvidence(result, answer = "") {
  const calls = Array.isArray(result?.tool_calls) ? result.tool_calls : [];
  const catalogVerified = calls.some((call) =>
    ["find_products", "get_product_detail"].includes(String(call?.name))
    && ["resolved", "needs_selection"].includes(String(call?.result_meta?.disposition)));
  const claimsPrice = /(?:\bTHB\b|฿|\d[\d,.]*\s*บาท)/iu.test(String(answer));
  if (claimsPrice) {
    return catalogVerified && calls.some((call) => call?.name === "get_exact_price"
      && /"ok":true,"exact_match":true/u.test(String(call?.result_summary ?? "")));
  }
  const claimsProductFact = /(?:\bSKU\b|สต็อก|พร้อมส่ง|สินค้าสั่งผลิต)/iu.test(String(answer));
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
