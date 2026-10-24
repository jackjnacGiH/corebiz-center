import assert from "node:assert/strict";
import test from "node:test";
import { activeItemContext, catalogueQuantity, customerProductLinks, linguisticText, resolvedActiveQuery } from "../supabase/functions/_shared/active-item-context.mjs";
import { routeLatestTurn } from "../supabase/functions/_shared/latest-turn-context.mjs";
import { extractModelCodes } from "../supabase/functions/_shared/product-selection.mjs";
import { normalizeConversationState } from "../supabase/functions/_shared/conversation-memory.mjs";

const mounted = [{ role: "user", content: "ล้อทรายแกน 3 มม เบอร์ 150" }, { role: "assistant", content: "ให้ทีมตรวจสอบสเปกค่ะ" }];
test("Thai mounted-wheel quantity variants retain the requested item, grit and shank with customer provenance", () => {
  for (const query of ["ค่ะ ต้องการ 10 ตัวค่ะ", "ต้องการ 10 ตัวค่ะ", "ต้องการ 10 ชิ้นค่ะ"]) {
    assert.equal(routeLatestTurn(query, mounted).kind, "follow_up");
    const state = activeItemContext(query, mounted);
    assert.equal(state.facts.quantity.value, 10);
    assert.equal(state.facts.unit.value, "piece");
    assert.equal(state.facts.grit.value, "150");
    assert.equal(state.facts.shank_mm.value, "3");
    assert.equal(state.facts.grit.source, "customer");
    assert.equal(state.catalogue_verified, false);
    assert.match(resolvedActiveQuery(state, query), /ล้อทราย.*150/);
    assert.equal(state.missing.includes("product"), false);
  }
});

test("rapid link, quotation, billing and repeat request retain the single customer-linked item", () => {
  const link = "https://www.jnac.online/p/2020004210";
  const history = [{ role: "user", content: link }]; // The prior bot answer has not arrived.
  let state = activeItemContext("ขอใบเสนอราคาตัวนี้ 1 แพ็ค", history);
  assert.equal(state.facts.requested_sku.value, "2020004210");
  assert.equal(state.facts.quantity.value, 1);
  assert.equal(state.facts.unit.value, "pack");
  assert.equal(state.quote_pending, true);
  history.push({ role: "user", content: "ขอใบเสนอราคาตัวนี้ 1 แพ็ค" }, { role: "assistant", content: "รบกวนแจ้งข้อมูลออกบิลค่ะ" }, { role: "user", content: "ชื่อบริษัท: ลูกค้าทดสอบ ที่อยู่ออกบิล: ทดสอบ เลขผู้เสียภาษี: ทดสอบ" });
  state = activeItemContext("ขอใบเสนอราคาตัวนี้ 1 แพ็คค่ะ", history);
  assert.equal(resolvedActiveQuery(state, "ตัวนี้"), "2020004210");
  assert.equal(state.quote_pending, true);
  assert.equal(JSON.stringify(state).includes("ลูกค้าทดสอบ"), false);
  assert.deepEqual(customerProductLinks("https://www.jnac.online.evil/p/2020004210"), []);
});

test("dimensions are specifications, never product codes or remembered SKUs", () => {
  for (const dimension of ["31.5x10x3.17", "30x10x3", "12x10x3"]) {
    assert.deepEqual(extractModelCodes(dimension), []);
    const normalized = normalizeConversationState({ products: [{ sku: dimension }] });
    assert.equal(normalized.products.length, 0);
    const state = activeItemContext(`${dimension} เบอร์ 120 จำนวน 10 ตัว`, mounted);
    assert.equal(state.facts.dimensions.value, dimension);
    assert.equal(state.facts.quantity.value, 10);
    assert.ok(state.conflicting.includes("grit"));
  }
  assert.deepEqual(extractModelCodes("SA331 31.5x10x3.17"), ["SA331"]);
});

test("real topic changes reset the old item, multi-item requests ask for disambiguation", () => {
  const changed = activeItemContext("ขอเปลี่ยนเป็นใบตัด 4 นิ้ว", mounted);
  assert.equal(changed.route, "new_product");
  assert.doesNotMatch(changed.identity, /ล้อทราย/);
  assert.equal(changed.facts.grit, undefined);
  const multi = activeItemContext("ขอใบตัดและจานทราย", mounted);
  assert.equal(multi.multiple, true);
  const links = activeItemContext("https://www.jnac.online/p/2020004210 https://www.jnac.online/p/2020004211", []);
  assert.equal(links.multiple, true);
});

test("pack conversion and technical conflicts cannot invent catalogue facts", () => {
  const state = activeItemContext("ขอใบเสนอราคาตัวนี้ 1 แพ็ค", [{ role: "user", content: "https://www.jnac.online/p/2020004210" }]);
  assert.deepEqual(catalogueQuantity(state, { unit: "ชิ้น", spec: {} }), { quantity: null, needs_review: true });
  assert.deepEqual(catalogueQuantity(state, { unit: "ชิ้น", spec: { pieces_per_pack: 10 } }), { quantity: 10, needs_review: false });
  assert.deepEqual(catalogueQuantity(state, { unit: "แพ็ค" }), { quantity: 1, needs_review: false });
  const packQuestion = activeItemContext("1 แพ็คมีกี่ตัวคะ", mounted);
  assert.equal(packQuestion.pack_question, true);
  assert.equal(packQuestion.facts.quantity, undefined);
});

test("URLs, SKUs and dimensions do not establish English; recorded staff remains context and native OA is unknown", () => {
  for (const query of ["https://www.jnac.online/p/2020004210", "SA331 3mm", "31.5x10x3.17 mm", "1 pack", "10 pieces"]) assert.doesNotMatch(linguisticText(query), /[A-Za-z]{2,}/);
  const state = activeItemContext("ขอคุยกับเจ้าหน้าที่ค่ะ", [...mounted, { role: "assistant", content: "[เจ้าหน้าที่]\nยืนยันสเปกอะไรคะ" }]);
  assert.equal(state.human_requested, true);
  assert.equal(state.facts.grit.value, "150");
  assert.equal(state.native_oa_staff_context, "unknown");
  assert.equal(state.catalogue_verified, false);
});
