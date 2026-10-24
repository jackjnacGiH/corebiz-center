import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acquireConversationTurn, currentConversationTurn, releaseConversationTurn, withConversationTurn } from "../supabase/functions/_shared/conversation-turn-lease.mjs";

function conversationDatabase() {
  const state = { bot_turn_token: null, bot_turn_until: null, bot_turn_revision: 0, bot_enabled: true };
  return { state, from() {
    let patch = null;
    const filters = [];
    const query = {
      select() { return query; }, update(value) { patch = value; return query; },
      eq(key, value) { if (key !== "id") filters.push([key, value]); return query; },
      is(key, value) { filters.push([key, value]); return query; },
      async maybeSingle() {
        if (!filters.every(([key, value]) => state[key] === value)) return { data: null, error: null };
        if (patch) Object.assign(state, patch);
        return { data: { ...state }, error: null };
      },
      then(resolve, reject) { return query.maybeSingle().then(resolve, reject); },
    };
    return query;
  } };
}

test("independent Edge callers serialize a rapid URL, quantity and billing burst", async () => {
  const db = conversationDatabase(), order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const options = { wait: async () => await new Promise(resolve => setTimeout(resolve, 1)) };
  const first = withConversationTurn(db, "test-chat", async () => {
    order.push("url:start"); await firstGate; order.push("url:stored-and-delivered");
  }, options);
  await new Promise(resolve => setImmediate(resolve));
  const second = withConversationTurn(db, "test-chat", async () => { order.push("quantity:history-after-url"); }, options);
  const third = withConversationTurn(db, "test-chat", async () => { order.push("billing:history-after-quantity"); }, options);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(order, ["url:start"]);
  releaseFirst(); await Promise.all([first, second, third]);
  assert.equal(order[1], "url:stored-and-delivered");
  assert.equal(db.state.bot_turn_token, null);
  assert.equal(db.state.bot_turn_revision, 3);
  // The lease prevents overlap; server delivery order follows whichever queued
  // event claims next. Customer timestamps remain in history for provenance.
  assert.equal(new Set(order.slice(2)).size, 2);
});

test("expired or superseded turns cannot send or clear a newer lease", async () => {
  const db = conversationDatabase();
  let now = Date.now();
  const old = await acquireConversationTurn(db, "test-chat", { now: () => now });
  now += 120_001;
  const current = await acquireConversationTurn(db, "test-chat", { now: () => now });
  assert.notEqual(old.token, current.token);
  assert.equal(await currentConversationTurn(db, "test-chat", old.token), false);
  await releaseConversationTurn(db, "test-chat", old);
  assert.equal(db.state.bot_turn_token, current.token);
  db.state.bot_enabled = false;
  assert.equal(await currentConversationTurn(db, "test-chat", current.token), false);
});

test("only the current server lease may be inherited and database errors fail closed", async () => {
  const db = conversationDatabase();
  const lease = await acquireConversationTurn(db, "test-chat");
  const inherited = await acquireConversationTurn(db, "test-chat", { inheritedToken: lease.token });
  assert.equal(inherited.owned, false);
  await releaseConversationTurn(db, "test-chat", inherited);
  assert.equal(db.state.bot_turn_token, lease.token);
  await assert.rejects(acquireConversationTurn(db, "test-chat", { inheritedToken: "wrong" }), /stale/);
  await assert.rejects(acquireConversationTurn({ from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: {} }) }; } }, "test-chat"), /unavailable/);
});

test("a busy conversation times out safely without running another event", async () => {
  const db = conversationDatabase();
  let now = Date.now();
  await acquireConversationTurn(db, "test-chat", { now: () => now });
  let executed = false;
  await assert.rejects(withConversationTurn(db, "test-chat", async () => { executed = true; }, {
    now: () => now, wait: async ms => { now += ms; },
  }), /busy_retryable/);
  assert.equal(executed, false);
});

test("LINE holds its lease across actual inbound storage, history, RAG and delivery", () => {
  const source = readFileSync(new URL("../supabase/functions/line-webhook/index.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function handleEvent("));
  assert.ok(handler.indexOf("withConversationTurn(admin, conversationId") < handler.indexOf('saveMessage(admin, conversationId, "customer"'));
  assert.match(source, /conversation_turn_token: turnToken/);
  assert.equal((handler.match(/currentConversationTurn\(admin, conversationId, lease.token\)/g) ?? []).length, 2);
});
