import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../supabase/functions/line-webhook/index.ts", import.meta.url), "utf8");
const fetchLimit = Number(/const CHAT_HISTORY_FETCH_LIMIT = (\d+);/u.exec(source)?.[1]);
const itemLimit = Number(/const CHAT_HISTORY_ITEM_LIMIT = TOKEN_OPTIMIZATION_ENABLED \? (\d+) :/u.exec(source)?.[1]);
assert.ok(fetchLimit >= itemLimit && itemLimit >= 16, "LINE history should retain a bounded product and quote exchange");
const start = source.indexOf("async function loadHistory(");
const end = source.indexOf("// LINE can send an image", start);
assert.ok(start >= 0 && end > start, "loadHistory source should be present");
const quoteStripStart = source.indexOf("function stripQuoteLink(");
const quoteStripEnd = source.indexOf("// A LINE reply", quoteStripStart);
assert.ok(quoteStripStart >= 0 && quoteStripEnd > quoteStripStart, "quote-link stripping should be present");

const fragment = source.slice(start, end).replace("async function loadHistory(", "export async function loadHistory(");
const { code } = await transform(`
  const CHAT_HISTORY_FETCH_LIMIT = ${fetchLimit};
  const CHAT_HISTORY_ITEM_LIMIT = ${itemLimit};
  const stripBlockedEmergencyNotice = (value) => value;
  ${source.slice(quoteStripStart, quoteStripEnd)}
  ${fragment}
`, { loader: "ts", format: "esm" });
const { loadHistory } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function historyAdmin(rows) {
  return {
    from(table) {
      assert.equal(table, "chat_messages");
      return {
        select(columns) {
          assert.match(columns, /external_msg_id/);
          this.orders = [];
          return this;
        },
        eq(field, value) {
          assert.equal(field, "conversation_id");
          assert.equal(value, "conversation-1");
          return this;
        },
        order(field, options) {
          assert.ok(field === "created_at" || field === "id");
          assert.equal(options.ascending, false);
          this.orders.push(field);
          return this;
        },
        limit(maximum) {
          assert.deepEqual(this.orders, ["created_at", "id"]);
          return { data: rows.slice(0, maximum).map((row) => ({ ...row })) };
        },
      };
    },
  };
}

test("LINE history stops at this event by message ID even when a newer message exists", async () => {
  // The DB returns newest first. A later customer event can arrive before this
  // event's bot request loads history, so the incoming event is not last.
  const rows = [
    { sender_type: "customer", content: "2 ม้วน", external_msg_id: "line-newer", metadata: null },
    { sender_type: "customer", content: "ม้วนใยสังเคราะห์ #400 ราคาเท่าไหร่", external_msg_id: "line-current", metadata: null },
    { sender_type: "bot", content: "สนใจสินค้าอะไรคะ", external_msg_id: null, metadata: null },
    { sender_type: "customer", content: "จานทราย XA945", external_msg_id: "line-older", metadata: null },
  ];
  const history = await loadHistory(historyAdmin(rows), "conversation-1", "line-current");
  assert.deepEqual(history, [
    { role: "user", content: "จานทราย XA945" },
    { role: "assistant", content: "สนใจสินค้าอะไรคะ" },
  ]);
});

test("LINE history keeps a different event with identical text", async () => {
  const rows = [
    { sender_type: "customer", content: "มีใบเจียรไหม", external_msg_id: "line-current", metadata: null },
    { sender_type: "customer", content: "มีใบเจียรไหม", external_msg_id: "line-older", metadata: null },
  ];
  assert.deepEqual(await loadHistory(historyAdmin(rows), "conversation-1", "line-current"), [
    { role: "user", content: "มีใบเจียรไหม" },
  ]);
});

test("LINE history keeps bot and Admin turns, but drops system notices and old public links", async () => {
  const rows = [
    { sender_type: "customer", content: "ต้องการ 100 เส้น", external_msg_id: "line-current", metadata: null },
    { sender_type: "bot", content: "ต้องการผ้าทรายสายพาน PACO Y966 จำนวนกี่ชิ้นดีคะ", external_msg_id: null, metadata: null },
    { sender_type: "system", content: "ระบบสร้างใบเสนอราคาอัตโนมัติ", external_msg_id: null, metadata: null },
    { sender_type: "agent", content: "สินค้า SKU 2020000905 ใช่ไหมคะ", external_msg_id: null, metadata: null },
    { sender_type: "bot", content: "เอยทำใบเสนอราคาเลขที่ QT-01000127 เรียบร้อยแล้วค่ะ\n\n📄 ใบเสนอราคา QT-01000127\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):\nhttps://www.jnac.online/center/q/old-token", external_msg_id: null, metadata: { quote_link: true } },
    { sender_type: "customer", content: "ผ้าทรายสายพาน PACO Y966 #60", external_msg_id: "line-older", metadata: null },
  ];
  const history = await loadHistory(historyAdmin(rows), "conversation-1", "line-current");
  assert.deepEqual(history, [
    { role: "user", content: "ผ้าทรายสายพาน PACO Y966 #60" },
    { role: "assistant", content: "เอยทำใบเสนอราคาเลขที่ QT-01000127 เรียบร้อยแล้วค่ะ" },
    { role: "assistant", content: "[เจ้าหน้าที่]\nสินค้า SKU 2020000905 ใช่ไหมคะ" },
    { role: "assistant", content: "ต้องการผ้าทรายสายพาน PACO Y966 จำนวนกี่ชิ้นดีคะ" },
  ]);
});

test("LINE history keeps sixteen dialogue turns including the product anchor", async () => {
  const prior = Array.from({ length: itemLimit }, (_, i) => ({
    sender_type: i % 2 ? "bot" : "customer",
    content: i === 0 ? "ผ้าทรายสายพาน PACO Y966 #60" : `turn ${i}`,
    external_msg_id: i % 2 ? null : `line-${i}`,
    metadata: null,
  }));
  const rows = [
    { sender_type: "customer", content: "ต้องการ 100 เส้น", external_msg_id: "line-current", metadata: null },
    ...prior.reverse(),
    { sender_type: "customer", content: "จานทรายเรื่องเก่า", external_msg_id: "line-unrelated", metadata: null },
  ];
  const history = await loadHistory(historyAdmin(rows), "conversation-1", "line-current");
  assert.equal(history.length, itemLimit);
  assert.equal(history[0].content, "ผ้าทรายสายพาน PACO Y966 #60");
  assert.ok(history.every((turn) => turn.content !== "จานทรายเรื่องเก่า"));
});

test("text and image handlers pass the incoming LINE ID to history loading", () => {
  assert.equal(source.match(/loadHistory\(admin, conversationId, msg\.id\)/g)?.length, 2);
  assert.doesNotMatch(source, /history\.slice\(0,\s*-1\)/);
});
