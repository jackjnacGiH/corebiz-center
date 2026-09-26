import { extractModelCodes } from "./product-selection.mjs";

const PRODUCT_NAME_RE = /กระดาษทราย|ผ้าทราย|จานทราย|ม้วน\s*ใย(?:ขัด)?\s*สังเคราะห์|สก๊อตไบรท์|สก๊อตไบร์ท|ล้อทราย|ล้อขัด|ลูกขัด|ใบ(?:ขัด|ตัด|เจียร)|หินเจียร|แผ่น(?:ขัด|เจียร)|แปรง(?:ลวด|ขัด)|สายพาน(?:ขัด|ทราย)|สว่านลม|เครื่องมือ(?:ลม)?|\b(?:flap\s*disc|nonwoven|scotch\s*brite)\b/iu;
const PRODUCT_BRAND_RE = /\b(?:DEERFOS|MIRKA|MIKA|KLINGSPOR|NORTON|VSM)\b/iu;
const PRODUCT_SWITCH_RE = /(?:ขอ)?เปลี่ยน(?:สินค้า)?(?:เป็น|ไป(?:หา)?)|แทน(?:ตัว|รุ่น|สินค้า)เดิม/iu;
const FACET_SWITCH_RE = /^(?:ขอ)?เปลี่ยน(?:เป็น|ไป)?\s*(?:เบอร์|ขนาด|ไซซ์|size|grit|สี|หลังอ่อน|หลังแข็ง|หลังกาว|สักหลาด|#\s*\d+)|^(?:ขอ)?เปลี่ยน(?:เบอร์|ขนาด|ไซซ์|size|grit|สี|หลัง).{0,12}เป็น/iu;
const DEPENDENT_PRODUCT_RE = /^(?:แล้ว|ส่วน|ถ้า|เลือก|รุ่น|ตัว|อัน|แบบ|ของ|อีก|ขอ(?:เป็น|เอา))\s*/iu;
const DEICTIC_FOLLOW_UP_RE = /^(?:(?:สินค้า|รุ่น|จาน|ตัว|อัน|แบบ)นี้|เอา(?:รุ่น|ตัว|อัน|แบบ)?นี้|(?:สั่ง|เอา|ต้องการ)\s*(?:จำนวน\s*)?\d+\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)|(?:ใช้|เอา|ขอ)\s*(?:เบอร์|ขนาด|ไซซ์|size|grit|สี|หลังอ่อน|หลังแข็ง|หลังกาว|สักหลาด))/iu;
const FOLLOW_UP_RE = /^(?:\d{1,2}(?:\s|$)|(?:จำนวน\s*)?\d{1,6}\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)|#\s*\d{1,5}|(?:เบอร์|ขนาด|ไซซ์|size|grit|สี|หลังอ่อน|หลังแข็ง|หลังกาว|สักหลาด)|\d+(?:\.\d+)?\s*(?:"|นิ้ว|mm|มม)|มี(?:รุ่น|แบบ|เบอร์)ไหน|รุ่นไหน|แนะนำ|ราคา(?:เท่าไร|เท่าไหร่|อะไร)|กี่บาท|เท่าไร|เท่าไหร่|(?:ทำ|ขอ|เอา)ใบเสนอราคา|เอา\s*\d|(?:เอา|ได้|ตกลง|โอเค|ครับ|yes)(?:เลย)?(?:ครับ|ค่ะ|คะ)?$|(?:ทำ|จัด)เลย(?:ครับ|ค่ะ|คะ)?$)/iu;
const QUANTITY_REPLY_RE = /^(?:(?:ต้องการ|เอา|สั่ง|จำนวน)\s*)?\d{1,6}\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)?(?:\s*(?:ครับ|ค่ะ|คะ))?$/iu;
const QUANTITY_QUESTION_RE = /(?:จำนวน\s*กี่|ต้องการ\s*กี่|กี่\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน|pcs?)|ต้องการปรับจำนวน|how many|what quantity)/iu;
const INDEPENDENT_QUESTION_RE = /(?:ชำระ|ชําระ|จ่าย|โอน|มัดจำ|มัดจํา|payment|pay\b|ค่าขนส่ง|จัดส่ง|ส่งของ|เวลาทำการ|เปิดกี่โมง|ที่อยู่|แผนที่|ใบเสนอราคา(?:เดิม|เลขที่|ที่ส่ง|ที่ทำ|แล้ว)|\bQT-\d+)/iu;
const SHORT_QUOTE_CONSENT_RE = /^(?:เอา|ได้|ตกลง|ทำ|ทํา|จัด|โอเค|yes|please do)(?:เลย)?(?:ครับ|ค่ะ|คะ|ด้วย)?[.!\s]*$/iu;
const POSITIVE_QUOTE_CHOICE_RE = /^ต้องการ(?:\s*ใบเสนอราคา)?(?:ครับ|ค่ะ|คะ)?[.!\s]*$/iu;
const NEGATIVE_QUOTE_CHOICE_RE = /^ไม่ต้องการ(?:\s*ใบเสนอราคา)?(?:ครับ|ค่ะ|คะ)?[.!\s]*$/iu;
const QUOTE_OFFER_RE = /(?:ใบเสนอราคา|quotation).{0,40}(?:ไหม|มั้ย|หรือเปล่า|หรือไม่|\?)/iu;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function catalogChoice(query, assistantText) {
  const text = clean(query).replace(/^(?:ขอ(?:เป็น|เอา)|เอา)\s*/iu, "");
  const choices = String(assistantText ?? "").split(/\r?\n/u)
    .map((line) => /^\s*\d{1,2}\.\s+(.+)$/u.exec(line)?.[1]?.trim())
    .filter(Boolean);
  if (choices.length === 0) return false;
  if (/^\d{1,2}[.)]?$/u.test(text)) return Number.parseInt(text, 10) <= choices.length;
  if (choices.some((choice) => choice === text || choice.replace(/\s*\(SKU\s+[^)]+\)\s*$/iu, "") === text)) return true;
  return /^[A-Z][A-Z0-9 ._-]{2,30}$/iu.test(text)
    && choices.filter((choice) => choice.toUpperCase().includes(text.toUpperCase())).length === 1;
}

function hasProductIdentity(query) {
  const text = clean(query);
  if (PRODUCT_NAME_RE.test(text) || PRODUCT_BRAND_RE.test(text)) return true;
  return extractModelCodes(text).some((code) => !/^(?:QT|SO|DN)\d+$/u.test(code));
}

function productKind(query) {
  const text = clean(query);
  if (/ม้วน\s*ใย|สก๊อตไบรท์|สก๊อตไบร์ท|\b(?:nonwoven|scotch\s*brite)\b/iu.test(text)) return "nonwoven_roll";
  if (/จานทราย|\bflap\s*disc\b/iu.test(text)) return "flap_disc";
  if (/กระดาษทราย|ผ้าทราย/iu.test(text)) return "sandpaper";
  if (/ใบเจียร|แผ่นเจียร/iu.test(text)) return "grinding_disc";
  if (/ใบตัด/iu.test(text)) return "cutting_disc";
  if (/สว่านลม/iu.test(text)) return "pneumatic_drill";
  return null;
}

function isNewProductTurn(query, precedingAssistant, priorTopicQuery) {
  const text = clean(query);
  if (!text || catalogChoice(text, precedingAssistant)) return false;
  if (FACET_SWITCH_RE.test(text)) return false;
  if (PRODUCT_SWITCH_RE.test(text)) return hasProductIdentity(text);
  if (!hasProductIdentity(text)) return false;
  if (!DEPENDENT_PRODUCT_RE.test(text) || !priorTopicQuery) return true;
  const currentKind = productKind(text);
  const previousKind = productKind(priorTopicQuery);
  if (currentKind && previousKind && currentKind !== previousKind) return true;
  const currentModels = extractModelCodes(text);
  const previousModels = extractModelCodes(priorTopicQuery);
  return currentModels.length > 0 && previousModels.length > 0
    && !currentModels.some((model) => previousModels.includes(model));
}

function isFollowUpTurn(query, precedingAssistant) {
  const text = clean(query);
  if (!text) return false;
  if (catalogChoice(text, precedingAssistant)) return true;
  if (INDEPENDENT_QUESTION_RE.test(text) && !/(?:ทำ|ขอ|เอา)ใบเสนอราคา/iu.test(text)) return false;
  if (QUANTITY_REPLY_RE.test(text) && QUANTITY_QUESTION_RE.test(precedingAssistant)) return true;
  if (SHORT_QUOTE_CONSENT_RE.test(text) && QUOTE_OFFER_RE.test(precedingAssistant)) return true;
  if ((POSITIVE_QUOTE_CHOICE_RE.test(text) || NEGATIVE_QUOTE_CHOICE_RE.test(text))
    && QUOTE_OFFER_RE.test(precedingAssistant)) return true;
  return FACET_SWITCH_RE.test(text) || DEICTIC_FOLLOW_UP_RE.test(text)
    || DEPENDENT_PRODUCT_RE.test(text) || FOLLOW_UP_RE.test(text);
}

/** Scope old turns to the latest product topic before any product routing. */
export function routeLatestTurn(query, history = []) {
  const turns = (Array.isArray(history) ? history : [])
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : "user";
      const raw = String(item?.content ?? "").trim();
      // The product resolver reads one numbered choice per line. Keep only
      // those bot offers multiline; normalize all other turns as before.
      const content = role === "assistant" && /^\s*1\.\s+/mu.test(raw) ? raw : clean(raw);
      return { role, content };
    })
    .filter((item) => item.content);
  let topicStart = -1;
  let topicQuery = null;
  for (let index = 0; index < turns.length; index++) {
    if (turns[index].role !== "user") continue;
    const previousAssistant = turns[index - 1]?.role === "assistant" ? turns[index - 1].content : "";
    if (isNewProductTurn(turns[index].content, previousAssistant, topicQuery)) {
      topicStart = index;
      topicQuery = turns[index].content;
    } else if (!isFollowUpTurn(turns[index].content, previousAssistant)) {
      topicStart = -1;
      topicQuery = null;
    }
  }
  const lastAssistant = turns.at(-1)?.role === "assistant" ? turns.at(-1).content : "";
  if (isNewProductTurn(query, lastAssistant, topicQuery)) {
    return { kind: "new_product", history: [], topicQuery: clean(query) };
  }
  if (!isFollowUpTurn(query, lastAssistant)) {
    return { kind: "independent", history: [], topicQuery: null };
  }
  if (topicStart < 0) {
    // The upstream history window can start with the bot's last offer. A short
    // response may still use that one adjacent offer, never an older product.
    const adjacentOffer = lastAssistant && /(?:SKU\s*[:：]?\s*[A-Z0-9._/-]+|^\s*1\.\s+|ใบเสนอราคา.{0,30}(?:ไหม|มั้ย)|จำนวน\s*กี่|ต้องการ\s*กี่|กี่\s*(?:ชิ้น|เส้น|ใบ|กล่อง|ม้วน))/imu.test(lastAssistant);
    const consentAfterOffer = turns.at(-1)?.role === "user"
      && (SHORT_QUOTE_CONSENT_RE.test(turns.at(-1).content)
        || POSITIVE_QUOTE_CHOICE_RE.test(turns.at(-1).content))
      && turns.at(-2)?.role === "assistant" && QUOTE_OFFER_RE.test(turns.at(-2).content);
    return adjacentOffer
      ? { kind: "follow_up", history: turns.slice(-1), topicQuery: null }
      : consentAfterOffer
      ? { kind: "follow_up", history: turns.slice(-2), topicQuery: null }
      : { kind: "independent", history: [], topicQuery: null };
  }
  return { kind: "follow_up", history: turns.slice(topicStart), topicQuery };
}
