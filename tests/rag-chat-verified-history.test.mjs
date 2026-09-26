import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../supabase/functions/rag-chat/index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function loadVerifiedChatHistory(");
const end = source.indexOf("/** Best-effort, privacy-safe run telemetry", start);
assert.ok(start >= 0 && end > start, "verified history loader should be present");
const fragment = source.slice(start, end).replace(
  "async function loadVerifiedChatHistory(", "export async function loadVerifiedChatHistory(",
);
const { code } = await transform(`
  const MAX_HISTORY_ITEMS = 16;
  const MAX_HISTORY_ITEM_CHARS = 1_200;
  ${fragment}
`, { loader: "ts", format: "esm" });
const { loadVerifiedChatHistory } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function historyAdmin(rows, dbError = null) {
  return {
    from(table) {
      assert.equal(table, "chat_messages");
      const state = { conversationId: null, cutoff: null, orders: [] };
      return {
        select(columns) {
          assert.match(columns, /sender_type, content/u);
          return this;
        },
        eq(field, value) {
          assert.equal(field, "conversation_id");
          state.conversationId = value;
          return this;
        },
        lt(field, value) {
          assert.equal(field, "created_at");
          state.cutoff = value;
          return this;
        },
        order(field, options) {
          assert.equal(options.ascending, false);
          state.orders.push(field);
          return this;
        },
        limit(maximum) {
          assert.equal(state.conversationId, "conversation-1");
          assert.equal(state.cutoff, "2026-09-26T05:08:00.000Z");
          assert.deepEqual(state.orders, ["created_at", "id"]);
          assert.equal(maximum, 24);
          if (dbError) return { data: null, error: dbError };
          const data = rows.filter((row) => row.conversation_id === state.conversationId
            && row.created_at < state.cutoff)
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
            .slice(0, maximum);
          return { data, error: null };
        },
      };
    },
  };
}

const conversation_id = "conversation-1";
const requestStartedAt = Date.parse("2026-09-26T05:08:00.000Z");
const row = (id, sender_type, content, created_at, extra = {}) => ({
  id, conversation_id, sender_type, content, created_at, ...extra,
});

test("verified history uses persisted customer, bot and Admin turns before the current request", async () => {
  const rows = [
    row("1", "customer", "ผ้าทรายสายพาน PACO Y966 #60", "2026-09-26T05:07:01.000Z"),
    row("2", "bot", "พบสินค้า SKU 2020000905 ค่ะ", "2026-09-26T05:07:02.000Z"),
    row("3", "agent", "ต้องการจำนวนกี่เส้นคะ", "2026-09-26T05:07:03.000Z"),
    row("4", "system", "ระบบบันทึกการสนทนา", "2026-09-26T05:07:04.000Z"),
    row("5", "bot", "เอยทำใบเสนอราคาเลขที่ QT-01000127 เรียบร้อยแล้วค่ะ\n\n📄 ใบเสนอราคา QT-01000127\nดูรายละเอียดและดาวน์โหลด PDF ได้เลย (ไม่ต้องล็อกอิน):\nhttps://www.jnac.online/center/q/old-token", "2026-09-26T05:07:05.000Z"),
    row("6", "customer", "ต้องการ 100 เส้น", "2026-09-26T05:08:00.000Z"),
    row("7", "bot", "future reply", "2026-09-26T05:08:01.000Z"),
    row("8", "customer", "wrong conversation", "2026-09-26T05:07:06.000Z", { conversation_id: "conversation-2" }),
  ];
  const history = await loadVerifiedChatHistory(historyAdmin(rows), conversation_id, requestStartedAt);
  assert.deepEqual(history, [
    { role: "user", content: "ผ้าทรายสายพาน PACO Y966 #60" },
    { role: "assistant", content: "พบสินค้า SKU 2020000905 ค่ะ" },
    { role: "assistant", content: "[เจ้าหน้าที่]\nต้องการจำนวนกี่เส้นคะ" },
    { role: "assistant", content: "เอยทำใบเสนอราคาเลขที่ QT-01000127 เรียบร้อยแล้วค่ะ" },
  ]);
});

test("verified history returns null on a database error", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await loadVerifiedChatHistory(
      historyAdmin([], { message: "database unavailable" }), conversation_id, requestStartedAt,
    ), null);
  } finally {
    console.warn = originalWarn;
  }
});
