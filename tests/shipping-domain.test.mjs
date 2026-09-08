import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  emptyDraft,
  parseDraft,
  readyIssues,
  moneyMinor,
  canUseShipping,
  acceptStatus,
  providerPayload,
} from "../supabase/functions/_shared/shipping-domain.ts";
import {
  signQuery,
  requestProvider,
} from "../supabase/functions/_shared/promptspeed.ts";

function ready() {
  const d = emptyDraft();
  for (const side of ["origin", "destination"])
    d[side] = {
      fullname: "Test contact",
      address: "Test address",
      county: "Test",
      city: "Test",
      state: "Test",
      postcode: "10230",
      email: "test@example.invalid",
      telephone1: "0000000000",
    };
  d.carrier_code = "EMS_SPEED";
  d.box_width = 20;
  d.box_height = 10;
  d.box_length = 30;
  d.box_weight = 1200;
  d.products = [
    { name: "Sample", code: "DEMO", qty: 1, price: "12.50", weight: 1000 },
  ];
  return d;
}
test("money uses exact minor units and rejects silent rounding, exponent and negatives", () => {
  assert.equal(moneyMinor("123.45"), 12345);
  assert.equal(moneyMinor("0.01"), 1);
  for (const v of ["1.001", "1e3", "-1", "NaN", 12.5, ""])
    assert.throws(() => moneyMinor(v));
});
test("draft normalization strips caller-controlled privileged properties", () => {
  const d = parseDraft({
    ...ready(),
    status: "delivered",
    tracking_number: "FAKE",
    wallet_balance: 999,
  });
  assert.equal("status" in d, false);
  assert.equal("wallet_balance" in d, false);
  assert.equal(d.products[0].price, "12.50");
});
test("draft can be incomplete but cannot submit", () => {
  assert.ok(readyIssues(parseDraft(emptyDraft())).length);
  assert.deepEqual(readyIssues(parseDraft(ready())), []);
});
test("COD needs an approved reference and normalizes no actual payout state", () => {
  const d = ready();
  d.cod_amount = "500";
  assert.ok(readyIssues(d).includes("cod_account_required"));
  d.cod_account_id = "00000000-0000-4000-8000-000000000002";
  const p = providerPayload(
    {
      draft: d,
      id: "00000000-0000-4000-8000-000000000001",
      reference_no: "SHP-DEMO",
    },
    "approved-id",
  );
  assert.equal(p.cod_account, "approved-id");
  assert.equal(p.external_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(p.cod_amount, 500);
  assert.equal("payment_status" in p, false);
});
test("bad quantities, unknown addresses and oversized names are rejected", () => {
  for (const mutate of [
    (d) => (d.box_weight = -1),
    (d) => (d.box_weight = Infinity),
    (d) => (d.products[0].qty = 1.5),
    (d) => (d.products[0].name = "x".repeat(101)),
    (d) => (d.origin = { fullname: "x" }),
  ]) {
    const d = ready();
    mutate(d);
    assert.throws(() => parseDraft(d));
  }
});
test("explicit staff grant required; inactive and public roles always denied", () => {
  assert.ok(canUseShipping({ role: "owner", is_active: true }, false));
  assert.ok(canUseShipping({ role: "staff", is_active: true }, true));
  for (const role of ["staff", "viewer", "agent", "customer"])
    assert.equal(canUseShipping({ role, is_active: true }, false), false);
  assert.equal(
    canUseShipping({ role: "owner", is_active: false }, true),
    false,
  );
  assert.equal(
    canUseShipping({ role: "customer", is_active: true }, true),
    false,
  );
});
test("late callbacks cannot rewind state and pickup cannot mark shipment delivered", () => {
  assert.equal(
    acceptStatus(
      "delivered",
      "waiting",
      "2026-09-08T01:00:00Z",
      "2026-09-08T02:00:00Z",
    ),
    false,
  );
  assert.equal(
    acceptStatus(
      "waiting",
      "delivered",
      "2026-09-08T02:00:00Z",
      "2026-09-08T01:00:00Z",
    ),
    false,
  );
  assert.equal(
    acceptStatus("waiting", "completed", null, "2026-09-08T01:00:00Z"),
    false,
  );
  assert.equal(
    acceptStatus("waiting", "delivered", null, "2026-09-08T01:00:00Z"),
    true,
  );
});
test("HMAC matches independently built concatenation and preserves duplicate queries", async () => {
  const q = await signQuery(
    "TEST-APP",
    "TEST-SECRET",
    { z: ["ไทย", "B"], a: "x y" },
    1000,
  );
  const k = Buffer.from("1000-TEST-APP").toString("base64");
  const expected = createHmac("sha256", "TEST-SECRET")
    .update("secret=TEST-SECRETa=x ykey=" + k + "timestamp=1000z=ไทยz=B")
    .digest("hex");
  assert.equal(q.get("signature"), expected);
  assert.deepEqual(q.getAll("z"), ["ไทย", "B"]);
  await assert.rejects(() => signQuery("a", "b", { signature: "fake" }));
});
test("provider is fail-closed before any network request", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new Error("must not call");
  };
  const cfg = {
    environment: "uat",
    appId: "test",
    secret: "test",
    specConfirmed: false,
    readsEnabled: true,
    mutationsEnabled: true,
  };
  await assert.rejects(
    () => requestProvider(cfg, "create", {}, {}, undefined, fetcher),
    /provider_not_ready/,
  );
  await assert.rejects(
    () =>
      requestProvider(
        { ...cfg, specConfirmed: true, mutationsEnabled: false },
        "create",
        {},
        {},
        undefined,
        fetcher,
      ),
    /provider_not_ready/,
  );
  assert.equal(calls, 0);
});
test("transport does not retry uncertain mutation or follow redirects", async () => {
  let calls = 0;
  const cfg = {
    environment: "uat",
    appId: "test",
    secret: "test",
    specConfirmed: true,
    readsEnabled: true,
    mutationsEnabled: true,
  };
  await assert.rejects(() =>
    requestProvider(cfg, "create", {}, {}, undefined, async (url, init) => {
      calls++;
      assert.equal(init.redirect, "error");
      assert.ok(
        String(url).startsWith("https://openapi-uat.promptspeed.co.th/"),
      );
      throw new Error("timeout");
    }),
  );
  assert.equal(calls, 1);
});
