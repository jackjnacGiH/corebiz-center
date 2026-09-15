import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apiSource = readFileSync(new URL("../frontend/src/lib/api.ts", import.meta.url), "utf8");
const memoryApiSource = readFileSync(new URL("../frontend/src/lib/bot-memory-api.ts", import.meta.url), "utf8");
const flowApiSource = readFileSync(new URL("../frontend/src/lib/flowaccount-api.ts", import.meta.url), "utf8");
const panelSource = readFileSync(
  new URL("../frontend/src/components/chat/ContactPanel.tsx", import.meta.url),
  "utf8",
);
const adminSource = readFileSync(
  new URL("../supabase/functions/bot-learning-admin/index.ts", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../frontend/src/pages/Settings.tsx", import.meta.url),
  "utf8",
);

test("conversation memory is loaded only after staff expands the panel", () => {
  assert.match(panelSource, /if \(nextOpen && !memory && !memoryLoading\) await loadMemory\(\)/);
  assert.doesNotMatch(
    panelSource.slice(
      panelSource.indexOf("// Load customer snapshot"),
      panelSource.indexOf("// Load packer staff list"),
    ),
    /getConversationMemory/,
  );
});

test("a slow memory request cannot leak the previous room into the active room", () => {
  assert.match(panelSource, /const memoryRequestRef = useRef\(0\)/);
  assert.match(panelSource, /memoryRequestRef\.current \+= 1/);
  assert.match(panelSource, /if \(memoryRequestRef\.current !== requestId\) return/);
});

test("browser memory access stays behind the staff Edge Function", () => {
  assert.match(memoryApiSource, /callBotMemory\('get_conversation_memory'/);
  assert.match(memoryApiSource, /callBotMemory\('update_conversation_memory'/);
  assert.doesNotMatch(memoryApiSource, /from\('bot_conversation_memory'\)/);
});

test("staff controls use the guarded RPC and never write the memory table directly", () => {
  const start = adminSource.indexOf('if (action === "update_conversation_memory")');
  const end = adminSource.indexOf('if (action === "list_candidates")', start);
  const update = adminSource.slice(start, end);
  assert.match(update, /\.rpc\(\s*"set_bot_conversation_memory_staff_control"/);
  assert.doesNotMatch(update, /\.from\("bot_conversation_memory"\)\.(?:insert|update|upsert|delete)/);
  assert.match(update, /\.select\("conversation_id, locked_fields, expires_at"\)/);
  assert.match(update, /Date\.parse\(String\(current\.expires_at\)\) <= Date\.now\(\)/);
  assert.match(update, /memory_expired/);
  assert.match(update, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
});

test("staff memory reads hide expired rows", () => {
  const start = adminSource.indexOf('if (action === "get_conversation_memory")');
  const end = adminSource.indexOf('if (action === "update_conversation_memory")', start);
  const getMemory = adminSource.slice(start, end);
  assert.match(getMemory, /const now = new Date\(\)\.toISOString\(\)/);
  assert.match(getMemory, /\.gt\("expires_at", now\)/);
});

test("staff memory view exposes bounded sales context without private identifiers", () => {
  const start = adminSource.indexOf("function memoryView");
  const end = adminSource.indexOf("Deno.serve", start);
  const view = adminSource.slice(start, end);
  for (const field of [
    "active_intent",
    "products",
    "application",
    "machine",
    "material",
    "confirmed_facts",
    "pending_questions",
    "preferences",
    "staff_note",
  ]) assert.match(view, new RegExp(field));
  assert.match(view, /normalizeConversationState\(rawState\)/);
  assert.match(view, /state\.products/);
  assert.match(view, /state\.confirmed_facts/);
  assert.doesNotMatch(view, /customer_id|tax_id|phone|email|address|net_unit_price|price_source/);
});

test("staff memory UI shows bounded product facts and describes the whole-room lock", () => {
  for (const field of ["product.sku", "product.name", "product.size", "product.grit", "product.unit", "product.quantity"]) {
    assert.match(panelSource, new RegExp(field.replace(".", "\\.")));
  }
  assert.match(panelSource, /memory\.confirmed_facts\.map/);
  assert.match(panelSource, /ข้อมูลที่ระบบยืนยันแล้ว/);
  assert.match(panelSource, /ล็อกความจำทั้งห้อง ไม่ให้ AI อัปเดตสรุปและข้อมูลอัตโนมัติ/);
  assert.doesNotMatch(panelSource, /ล็อกข้อมูลที่พนักงานยืนยัน ไม่ให้ AI เปลี่ยนเอง/);
  assert.match(memoryApiSource, /products: BotConversationMemoryProduct\[\]/);
  assert.match(memoryApiSource, /confirmed_facts: string\[\]/);
});

test("staff notes reject financial, credential and personal data", () => {
  const start = adminSource.indexOf("function isSafeStaffMemoryNote");
  const end = adminSource.indexOf("function safeMemoryText", start);
  const guard = adminSource.slice(start, end);
  for (const token of ["price", "stock", "password", "token", "payment", "ราคา", "เลขผู้เสียภาษี"]) {
    assert.match(guard, new RegExp(token, "i"));
  }
  for (const valuePattern of ["emailValue", "thaiPhoneValue", "taxIdValue", "moneyValue"]) {
    assert.match(guard, new RegExp(valuePattern));
  }
  assert.match(adminSource, /unsafe_memory_note/);
});

test("FlowAccount browser UI receives metadata only and never token fields", () => {
  assert.match(flowApiSource, /get_flowaccount_mcp_status/);
  assert.match(flowApiSource, /flowaccount-price-sync/);
  assert.match(flowApiSource, /sync\.latest_run/);
  assert.match(flowApiSource, /latestRun\.eligible_count/);
  assert.doesNotMatch(flowApiSource, /access_token|refresh_token|client_secret/i);
  assert.match(settingsSource, /ระบบนี้ไม่สร้าง แก้ไข หรือลบเอกสารใน FlowAccount/);
});

test("structured memory has an independent operator control", () => {
  assert.match(settingsSource, /settings\.structured_memory_enabled/);
  assert.match(adminSource, /patch\.structured_memory_enabled/);
  assert.match(apiSource, /BotLearningSettings/);
});
