import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "../supabase/functions/_shared/shipping-domain.ts";
import { aggregateShippingRates, compareShippingRates } from "../supabase/functions/_shared/shipping-rates.ts";

const carriers = ["A", "B", "C"].map(code => ({ code, name: code, logo: null }));
const rate = (carrier_code, total) => ({ carrier_code, total, delivery_time: "1-3 days" });
test("rank only complete shipment prices, sum all boxes exactly, and preserve ties", () => {
  const result = aggregateShippingRates(carriers, [
    [rate("A", "1.2345"), rate("B", "0.5000"), rate("C", "0.0100")],
    [rate("A", "2.3456"), rate("B", "3.0801")],
  ]);
  assert.equal(result[0].total, "3.5801");
  assert.equal(result[1].total, "3.5801");
  assert.ok(result[0].cheapest && result[1].cheapest);
  const partial = result.find(r => r.carrier_code === "C");
  assert.equal(partial.available, false);
  assert.equal(partial.total, null);
  assert.equal(partial.cheapest, false);
  assert.equal(partial.quoted_parcels, 1);
});
test("invalid or ambiguous provider totals never become free shipping", () => {
  for (const total of [null, "", "NaN", "-1", "1.00001", "1e3", Infinity])
    assert.equal(aggregateShippingRates([carriers[0]], [[rate("A", total)]])[0].available, false);
  assert.equal(aggregateShippingRates([carriers[0]], [[rate("A", "1"), rate("A", "2")]])[0].available, false);
  assert.equal(aggregateShippingRates(carriers, []).some(r => r.cheapest), false);
});
function draft() {
  const d = emptyDraft();
  for (const side of ["origin", "destination"])
    Object.assign(d[side], { county: "Area", city: "City", state: "Province", postcode: "10280" });
  const p = { box_width: 10, box_height: 20, box_length: 30, box_weight: 200 };
  d.parcel_total = 3;
  d.parcels = [p, { ...p }, { ...p, box_weight: 400 }];
  return d;
}
test("compare discovers account carriers and reuses identical-box quotes without a selected carrier", async () => {
  const calls = [];
  const request = async (_config, operation, payload) => {
    calls.push({ operation, payload });
    if (operation === "carriers") return { status: 200, data: { data: [{ code: "A", description: "Carrier A" }, { code: "B", description: "Carrier B", logo: "javascript:bad" }] } };
    assert.deepEqual(payload.carriers_code, ["A", "B"]);
    assert.equal("fullname" in payload.destination, false);
    return { status: 200, data: { data: [rate("A", payload.box_weight === 200 ? "10.0000" : "25.0000"), rate("B", "20.0000")] } };
  };
  const result = await compareShippingRates({}, draft(), undefined, request);
  assert.equal(calls.filter(c => c.operation === "quote").length, 2);
  assert.equal(result.rates[0].carrier_code, "A");
  assert.equal(result.rates[0].total, "45.0000");
  assert.deepEqual(result.rates[0].parcels.map(p => p.total), ["10.0000", "10.0000", "25.0000"]);
  assert.equal(result.rates[1].logo, null);
  assert.equal(result.parcel_count, 3);
});
test("failed provider requests do not return misleading partial comparisons", async () => {
  await assert.rejects(compareShippingRates({}, draft(), undefined, async (_c, operation) =>
    operation === "carriers" ? { status: 200, data: { data: [{ code: "A" }] } } : { status: 503, data: {} }), /provider_rejected/);
});
test("a dropped read connection retries once without issuing shipment mutations", async () => {
  let dropped = false;
  const operations = [];
  const result = await compareShippingRates({}, draft(), undefined, async (_c, operation) => {
    operations.push(operation);
    if (operation === "carriers") return { status: 200, data: { data: [{ code: "A" }] } };
    if (!dropped) { dropped = true; throw new TypeError("fetch failed"); }
    return { status: 200, data: { data: [rate("A", "10.00")] } };
  });
  assert.equal(result.rates[0].total, "30.0000");
  assert.equal(operations.filter(op => op === "quote").length, 3);
  assert.ok(operations.every(op => ["carriers", "quote"].includes(op)));
});
