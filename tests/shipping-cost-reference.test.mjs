import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emptyDraft } from "../supabase/functions/_shared/shipping-domain.ts";
import { calculateShippingCostReference } from "../supabase/functions/_shared/shipping-cost-reference.ts";

const draftFor = (parcel, destination = "ชลบุรี", count = 1) => {
  const draft = emptyDraft();
  draft.origin.state = "สมุทรปราการ";
  draft.destination.state = destination;
  draft.parcel_total = count;
  draft.parcels = Array.from({ length: count }, () => ({ ...parcel }));
  return draft;
};
const sampleBox = { box_width: 39, box_length: 39, box_height: 18, box_weight: 580 };

test("PDF reference keeps API-independent EMS base and conditional special-area range", () => {
  const result = calculateShippingCostReference("EMS_SPEED", draftFor(sampleBox));
  assert.equal(result.available, true);
  assert.equal(result.base, "21.00");
  assert.deepEqual(result.extras, [
    { kind: "special_area", amount: "20.00", conditional: true },
  ]);
  assert.equal(result.total, "21.00");
  assert.equal(result.total_with_conditional, "41.00");
});

test("PDF reference applies volumetric KEX tier and pickup fee without changing the API quote", () => {
  const result = calculateShippingCostReference("KEX_SPEED", draftFor(sampleBox));
  assert.equal(result.base, "57.00");
  assert.deepEqual(result.extras, [
    { kind: "pickup", amount: "15.00", conditional: false },
    { kind: "special_area", amount: "50.00", conditional: true },
  ]);
  assert.equal(result.total, "72.00");
  assert.equal(result.total_with_conditional, "122.00");
});

test("PDF reference uses size tiers, rejects outside-table parcels, and never invents missing carriers", () => {
  const flash = calculateShippingCostReference("FLASH_EXPRESS_SPEED", draftFor(sampleBox));
  assert.equal(flash.base, "98.00");
  assert.equal(flash.total_with_conditional, "148.00");

  const outside = calculateShippingCostReference("DHL_SPEED", draftFor({ ...sampleBox, box_weight: 40_000 }));
  assert.equal(outside.available, false);
  assert.equal(outside.reason, "outside_pdf_conditions");

  const missing = calculateShippingCostReference("RTT_SPEED", draftFor(sampleBox));
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "not_in_pdf");
});

test("rate cards render the PDF reference as small red text under the live price", () => {
  const component = readFileSync(new URL("../frontend/src/components/shipping/ShippingRateComparison.tsx", import.meta.url), "utf8");
  const translations = readFileSync(new URL("../frontend/src/lib/shipping-i18n.ts", import.meta.url), "utf8");
  assert.match(component, /shipping-pdf-reference-cost/);
  assert.match(component, /text-red-600/);
  assert.match(translations, /ไม่มีข้อมูลต้นทุนใน PDF 04\/2026/);
});
