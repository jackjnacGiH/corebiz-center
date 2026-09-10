import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  readOnlyToolDecision,
  resolveReadOnlyRequest,
} from "../supabase/functions/_shared/rag-read-only.mjs";

const ragSource = readFileSync(
  new URL("../supabase/functions/rag-chat/index.ts", import.meta.url),
  "utf8",
);
const evalSource = readFileSync(
  new URL("../scripts/omnichat-rag-eval.mjs", import.meta.url),
  "utf8",
);

test("read-only mode requires the internal service role and no conversation context", () => {
  assert.deepEqual(resolveReadOnlyRequest({
    requested: false,
    internalServiceCall: false,
    hasSessionId: true,
    hasConversationId: true,
  }), { enabled: false, status: null, error: null });
  assert.equal(resolveReadOnlyRequest({
    requested: true,
    internalServiceCall: false,
    hasSessionId: false,
    hasConversationId: false,
  }).status, 403);
  assert.equal(resolveReadOnlyRequest({
    requested: true,
    internalServiceCall: true,
    hasSessionId: true,
    hasConversationId: false,
  }).status, 400);
  assert.equal(resolveReadOnlyRequest({
    requested: true,
    internalServiceCall: true,
    hasSessionId: false,
    hasConversationId: true,
  }).status, 400);
  assert.deepEqual(resolveReadOnlyRequest({
    requested: true,
    internalServiceCall: true,
    hasSessionId: false,
    hasConversationId: false,
  }), { enabled: true, status: null, error: null });
});

test("read-only mode executes catalog reads and records suppressed mutations", () => {
  for (const name of [
    "find_products",
    "get_product_detail",
    "list_product_groups",
    "get_group_members",
    "list_categories",
  ]) {
    assert.deepEqual(readOnlyToolDecision(name, true), {
      execute: true,
      recordSuppressed: false,
      result: null,
    });
  }
  for (const name of ["capture_lead", "request_quote", "link_quote_customer", "future_mutation"]) {
    const decision = readOnlyToolDecision(name, true);
    assert.equal(decision.execute, false);
    assert.equal(decision.recordSuppressed, true);
    assert.deepEqual(decision.result, {
      ok: false,
      suppressed: true,
      read_only: true,
      reason: "read_only",
    });
  }
});

test("rag-chat integrates read-only guards across persistence and tool paths", () => {
  assert.match(ragSource, /requested: body\.read_only === true/);
  assert.match(ragSource, /internalServiceCall,[\s\S]*hasSessionId:[\s\S]*hasConversationId:/);
  assert.match(ragSource, /const persistMessages = !internalConversationId && !readOnly/);
  assert.match(ragSource, /if \(!readOnly\) recordFailedAiRun/g);
  assert.match(ragSource, /if \(readOnly\) return;[\s\S]*recordAiRun/);
  assert.match(ragSource, /readOnlyToolDecision\("capture_lead", readOnly\)/);
  assert.match(ragSource, /else if \(readOnlySuppressed\)[\s\S]*read_only_suppressed: true/);
  assert.match(ragSource, /if \(!readOnly\) \{[\s\S]*runInBackground\("post_reply"/);
  assert.match(ragSource, /channel, read_only: readOnly/);
});

test("evaluation runner authenticates internally and requires server confirmation", () => {
  assert.match(evalSource, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(evalSource, /process\.env\.SUPABASE_ANON_KEY/);
  assert.match(evalSource, /apikey: serviceRole, Authorization: `Bearer \$\{serviceRole\}`/);
  assert.match(evalSource, /read_only: true/);
  assert.match(evalSource, /server did not confirm read_only mode/);
});
