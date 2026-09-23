import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { recoverEmptyProductAnswer } from "../supabase/functions/_shared/empty-product-recovery.mjs";
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const sourceUrl = new URL("../supabase/functions/rag-chat/index.ts", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("fixtures/sa331-catalog.json", import.meta.url), "utf8"));
const productFields = ["sku", "name_th", "name_en", "brand"];

async function loadEdge(source = readFileSync(sourceUrl, "utf8"), scoring = true) {
  const bundle = await build({ stdin: {
    contents: source + "\nexport { findProducts, productFamilyFor, productTypeFor };",
    resolveDir: fileURLToPath(new URL("../supabase/functions/rag-chat/", import.meta.url)), loader: "ts",
  }, bundle: true, write: false, format: "cjs", platform: "node", plugins: [{ name: "mock-remote-imports", setup(build) {
    build.onResolve({ filter: /^(https:|jsr:)/ }, args => ({ path: args.path, namespace: "remote" }));
    build.onLoad({ filter: /.*/, namespace: "remote" }, () => ({ contents: "export const createClient = () => { throw new Error('No network in integration test'); };" }));
  } }] });
  const module = { exports: {} };
  new Function("module", "exports", "Deno", bundle.outputFiles[0].text)(module, module.exports, {
    env: { get: (key) => key === "PRODUCT_SCORE_SUGGESTIONS_ENABLED" ? String(scoring) : undefined }, serve: () => {},
  });
  return module.exports;
}
const edge = await loadEdge();
function fakeAdmin(rows = catalog) {
  return {
    from(table) {
      let result = table === "products" ? rows : [];
      let count = 0;
      const chain = {
        select() { return chain; },
        eq(key, value) { result = result.filter(row => row[key] === value); return chain; },
        or(expression) {
          const conditions = expression.split(",").map(part => {
            const [key, , ...patterns] = part.split(".");
            const regex = new RegExp(patterns.join(".").split("%").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"), "i");
            return row => regex.test(String(row[key] ?? ""));
          });
          result = result.filter(row => conditions.some(condition => condition(row))); return chain;
        },
        in(key, values) { result = result.filter(row => values.includes(row[key])); return chain; },
        order() { return chain; },
        limit(max) { count = result.length; result = result.slice(0, max); return chain; },
        then(resolve, reject) { return Promise.resolve({ data: result, error: null, count: count || result.length }).then(resolve, reject); },
      };
      return chain;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
}

test("full findProducts resolves photograph query to one scored candidate among 189 live catalog rows", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #1500');
  assert.equal(result.selection_required, true);
  assert.deepEqual(result.clarification_candidates.map(p => p.sku), ["2020000992"]);
  assert.equal(result.clarification_candidates[0].match_score, 80);
});
test("button selection resolves exact SKU, without remaining confirmation", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทรายกลมสักหลาด SA331 5" #1500');
  assert.equal(result.selection_required, undefined);
  assert.equal(result.count, 1);
  assert.equal(result.products[0].sku, "2020000992");
  assert.equal(result.products[0].price_lookup_required, true);
});
test("existing SA331 query still asks size and grit", async () => {
  const result = await edge.findProducts(fakeAdmin(), "สนใจกระดาษทราย DEERFOS SA331");
  assert.equal(result.selection_required, true);
  assert.ok(result.missing_fields.includes("size"));
  assert.ok(result.missing_fields.includes("grit"));
});
test("grit 150 returns its own SKU, never the 1500 SKU", async () => {
  const result = await edge.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #150');
  assert.deepEqual(result.clarification_candidates.map(p => p.sku), ["2020000980"]);
});
for (const query of ['กระดาษทราย DEERFOS SA331VC 5" #1500 หลังกาว', 'ล้อทราย DEERFOS SA331VC 5" #1500', 'กระดาษทราย MIRKA SA331VC 5" #1500']) {
  test(`full search rejects conflicting specification: ${query}`, async () => {
    const result = await edge.findProducts(fakeAdmin(), query);
    assert.equal(result.count, 0);
    assert.equal(result.clarification_candidates, undefined);
  });
}
test("feature flag disables scored fallback for rollback", async () => {
  const legacy = await loadEdge(undefined, false);
  const result = await legacy.findProducts(fakeAdmin(), 'กระดาษทราย DEERFOS SA331VC 5" #1500');
  assert.equal(result.count, 0);
  assert.equal(result.clarification_candidates, undefined);
});
test("empty AI completion on incomplete SA331VC question asks only for missing catalog facets", async () => {
  const query = "มี กระดาษทรายกลมสักหลาด SA331VC 5 จำหน่ายหมครับ";
  const recovered = await recoverEmptyProductAnswer(query, [], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.match(recovered.answer, /SA331VC/);
  assert.match(recovered.answer, /เบอร์ความละเอียด/);
  assert.equal(recovered.answer.includes("2020000992"), false);
  assert.equal(recovered.answer.includes("8.5"), false);
});
test("short follow-up after an unanswered product turn reuses only the adjacent customer query", async () => {
  const history = [{ role: "user", content: "มี กระดาษทรายกลมสักหลาด SA331VC 5 จำหน่ายหมครับ" }];
  const recovered = await recoverEmptyProductAnswer("มีไหนครับ", history, "th", q => edge.findProducts(fakeAdmin(), q));
  assert.match(recovered.answer, /เบอร์ความละเอียด/);
  assert.equal(recovered.lookupQuery, "SA331");
  const unrelated = await recoverEmptyProductAnswer("มีไหนครับ", [{ role: "assistant", content: history[0].content }], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.equal(unrelated.answer, null);
});
test("empty AI completion on complete 80-point query offers the one confirmed-choice candidate", async () => {
  const recovered = await recoverEmptyProductAnswer('กระดาษทราย DEERFOS SA331VC 5" #1500', [], "th", q => edge.findProducts(fakeAdmin(), q));
  assert.equal(recovered.result.clarification_candidates[0].sku, "2020000992");
  assert.match(recovered.answer, /1\. กระดาษทรายกลมสักหลาด SA331 5" #1500/);
});
