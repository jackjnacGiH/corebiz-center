import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transform } from "esbuild";

const source = readFileSync(new URL("../supabase/functions/line-webhook/index.ts", import.meta.url), "utf8");
const start = source.indexOf("async function loadHistory(");
const end = source.indexOf("// LINE can send an image", start);
assert.ok(start >= 0 && end > start, "loadHistory source should be present");

const fragment = source.slice(start, end).replace("async function loadHistory(", "export async function loadHistory(");
const { code } = await transform(`
  const CHAT_HISTORY_FETCH_LIMIT = 50;
  const CHAT_HISTORY_ITEM_LIMIT = 20;
  const stripBlockedEmergencyNotice = (value) => value;
  const stripQuoteLink = (value) => value;
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
          return this;
        },
        eq(field, value) {
          assert.equal(field, "conversation_id");
          assert.equal(value, "conversation-1");
          return this;
        },
        order(field, options) {
          assert.equal(field, "created_at");
          assert.equal(options.ascending, false);
          return this;
        },
        limit(maximum) {
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

test("text and image handlers pass the incoming LINE ID to history loading", () => {
  assert.equal(source.match(/loadHistory\(admin, conversationId, msg\.id\)/g)?.length, 2);
  assert.doesNotMatch(source, /history\.slice\(0,\s*-1\)/);
});
