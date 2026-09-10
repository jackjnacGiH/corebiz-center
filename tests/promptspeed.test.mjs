import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  parseProviderResponse,
  providerCancelAccepted,
  providerCreateResult,
  providerDefinitiveRejection,
  providerPrintLink,
  providerReadFailure,
  providerRejectionIssue,
  providerRows,
  reconcileCreatedShipment,
  requestProvider,
  signQuery,
  testProviderConnection,
} from "../supabase/functions/_shared/promptspeed.ts";

const config = {
  environment: "uat",
  appId: "APP-ID",
  secret: "SECRET-VALUE",
  specConfirmed: true,
  readsEnabled: true,
  mutationsEnabled: true,
};
const envelope = (status, data, requestId = null) => ({
  status,
  ok: status >= 200 && status < 300,
  data,
  requestId,
  code: null,
  message: null,
});

test("HMAC signing is deterministic and preserves repeated query values", async () => {
  const timestamp = 1_725_000_000_000;
  const query = {
    viewpoint: "all",
    carriers_code: ["EMS_SPEED", "KEX_SPEED"],
    limit: "100",
  };
  const params = await signQuery(config.appId, config.secret, query, timestamp);
  const key = Buffer.from(`${timestamp}-${config.appId}`).toString("base64");
  const expectedBase = `secret=${config.secret}` + [
    "carriers_code=EMS_SPEEDcarriers_code=KEX_SPEED",
    `key=${key}`,
    "limit=100",
    `timestamp=${timestamp}`,
    "viewpoint=all",
  ].join("");
  const expected = createHmac("sha256", config.secret).update(expectedBase).digest("hex");

  assert.equal(params.get("key"), key);
  assert.equal(params.get("timestamp"), String(timestamp));
  assert.equal(params.get("signature"), expected);
  assert.deepEqual(params.getAll("carriers_code"), ["EMS_SPEED", "KEX_SPEED"]);
  await assert.rejects(
    () => signQuery(config.appId, config.secret, { signature: "caller-value" }),
    /reserved_query_key/,
  );
});

test("V3 envelopes accept all 2xx statuses and expose only bounded parsed fields", () => {
  const created = parseProviderResponse(201, JSON.stringify({
    data: { tracking_number: "TH1234567890", charge: "35.0000", wallet_balance: "100.0000" },
    request_id: "request-create",
  }), [config.appId, config.secret]);
  assert.equal(created.ok, true);
  assert.deepEqual(providerCreateResult(created), {
    trackingNumber: "TH1234567890",
    charge: "35.0000",
    walletBalance: "100.0000",
    requestId: "request-create",
  });

  const printed = parseProviderResponse(200,
    '{"code":200,"message":"success","data":{"link":"https://labels.example.test/a.pdf"},"request_id":"request-print"}');
  assert.equal(providerPrintLink(printed), "https://labels.example.test/a.pdf");
  assert.equal(printed.requestId, "request-print");

  const pdf = Buffer.from("%PDF-1.4\n%%EOF").toString("base64");
  const arrayPrint = envelope(200, { data: [
    { tracking_number: "TH1234567890", parcel_id: "parcel-1", link: `data:application/pdf;base64,${pdf}` },
  ] });
  assert.equal(
    providerPrintLink(arrayPrint, "TH1234567890"),
    `data:application/pdf;base64,${pdf}`,
  );
  assert.equal(providerPrintLink(arrayPrint, "TH0000000000"), null);

  const listed = parseProviderResponse(206, JSON.stringify({
    data: [{ tracking_number: "TH1234567890", status: "waiting" }],
    request_id: "request-list",
  }));
  assert.equal(providerRows(listed).length, 1);
  assert.equal(listed.requestId, "request-list");

  const canceled = parseProviderResponse(200,
    '{"data":{"status":"ok"},"timestamp":"2024-09-19 03:43:27","request_id":"request-cancel"}');
  assert.equal(providerCancelAccepted(canceled), true);
});

test("validation envelopes, invalid successful bodies and unsafe print URLs fail closed", () => {
  const rejected = parseProviderResponse(200, JSON.stringify({
    code: "ERROR_VALIDATION",
    message: `bad ${config.secret} signature=abcdef`,
    request_id: "request-error",
  }), [config.secret]);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.requestId, "request-error");
  assert.ok(!rejected.message.includes(config.secret));
  assert.ok(!rejected.message.includes("abcdef"));
  assert.throws(() => parseProviderResponse(200, "not-json"), /provider_response_invalid/);
  assert.equal(parseProviderResponse(502, "gateway unavailable").code, "HTTP_502");
  assert.equal(providerPrintLink(parseProviderResponse(200,
    '{"data":{"link":"http://labels.example.test/a.pdf"}}')), null);
  assert.equal(providerPrintLink(envelope(200, {
    data: [{ tracking_number: "TH1234567890", link: "data:text/html;base64,PHNjcmlwdD4=" }],
  }), "TH1234567890"), null);
  assert.equal(providerPrintLink(envelope(200, {
    data: [{ tracking_number: "TH1234567890", link: `data:application/pdf;base64,JVBERi0${"A".repeat(1_900_001)}` }],
  }), "TH1234567890"), null);
  assert.equal(providerCancelAccepted(parseProviderResponse(204, "")), false);
});

test("provider rejection details are reduced to safe user-facing issue codes", () => {
  const cases = [
    [400, "Invalid telephone format.", "invalid_phone"],
    [400, "The box length must be between 0 - 180 cm", "box_dimension_exceeded"],
    [400, "Wallet balance is insufficient", "wallet_insufficient"],
    [400, "Postcode does not match address", "invalid_postcode"],
    [401, "Unauthorized signature", "provider_authentication_failed"],
    [429, "Too many requests", "provider_rate_limited"],
    [400, "Rate version not support in range", "carrier_service_unavailable"],
    [400, "Unknown validation rule", "provider_validation_failed"],
  ];
  for (const [status, message, expected] of cases) {
    const response = parseProviderResponse(status, JSON.stringify({
      code: "ERROR_VALIDATION",
      message,
      request_id: "safe-request-id",
    }));
    assert.equal(providerRejectionIssue(response), expected, message);
  }
  const secret = "NEVER-RETURN-THIS-SECRET";
  const response = parseProviderResponse(400, JSON.stringify({
    code: "ERROR_AUTH",
    message: `bad secret=${secret}`,
  }), [secret]);
  assert.equal(providerRejectionIssue(response), "provider_authentication_failed");
  assert.ok(!JSON.stringify(providerRejectionIssue(response)).includes(secret));
});

test("provider read failures prioritize HTTP authentication, throttling and service status", () => {
  const response = (status, message) => ({
    status,
    ok: false,
    data: { code: "ERROR_VALIDATION", message },
    requestId: "provider-request-id",
    code: "ERROR_VALIDATION",
    message,
  });
  assert.equal(providerReadFailure(response(401, "wallet balance is insufficient")), "provider_authentication_failed");
  assert.equal(providerReadFailure(response(403, "invalid telephone")), "provider_authentication_failed");
  assert.equal(providerReadFailure(response(429, "invalid telephone")), "provider_rate_limited");
  assert.equal(providerReadFailure(response(503, "invalid telephone")), "provider_unreachable");
  assert.equal(providerReadFailure({ ...response(200, "success"), ok: true }), "provider_response_invalid");
});

test("only a definite non-transient 4xx provider envelope is safe to retry", () => {
  const validation = parseProviderResponse(400,
    '{"code":"ERROR_VALIDATION","message":"wallet balance is insufficient","request_id":"request-wallet"}');
  assert.equal(providerDefinitiveRejection(validation), true);
  assert.equal(providerDefinitiveRejection(parseProviderResponse(429,
    '{"code":"ERROR_RATE_LIMIT","message":"try later"}')), false);
  assert.equal(providerDefinitiveRejection(parseProviderResponse(500,
    '{"code":"ERROR_INTERNAL","message":"unknown"}')), false);
  assert.equal(providerDefinitiveRejection(parseProviderResponse(400, "proxy rejection")), false);
});

test("transport uses the documented methods and paths without putting the secret in the URL", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/shipment/print"))
      return new Response('{"code":200,"message":"success","data":{"link":"https://labels.example.test/a.pdf"}}', { status: 200, headers: { "Content-Type": "text/plain" } });
    if (String(url).includes("/shipment/cancel/"))
      return new Response('{"data":{"status":"ok"}}', { status: 200 });
    if (init.method === "POST")
      return new Response('{"data":{"tracking_number":"TH1234567890"}}', { status: 201 });
    return new Response('{"data":[]}', { status: 200 });
  };
  await requestProvider(config, "create", { reference_no: "SHP-1" }, {}, undefined, fetcher);
  await requestProvider(config, "print", { tracking_number: ["TH1234567890"] }, {}, undefined, fetcher);
  await requestProvider(config, "list", undefined, { viewpoint: "all" }, undefined, fetcher);
  const canceled = await requestProvider(config, "cancel", undefined, {}, "TH1234567890", fetcher);
  assert.deepEqual(calls.map((call) => call.init.method), ["POST", "POST", "GET", "PUT"]);
  assert.ok(calls[0].url.includes("/api/v3/shipment?"));
  assert.ok(calls[1].url.includes("/api/v3/shipment/print?"));
  assert.ok(calls[2].url.includes("/api/v3/shipment?"));
  assert.ok(calls[3].url.includes("/api/v3/shipment/cancel/TH1234567890?"));
  assert.ok(calls.every((call) => !call.url.includes(config.secret)));
  assert.equal(providerCancelAccepted(canceled), true);
});

test("transport maps an aborted request to a bounded timeout error", async () => {
  const fetcher = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  await assert.rejects(
    () => requestProvider(config, "carriers", undefined, {}, undefined, fetcher, 5),
    /provider_timeout/,
  );
});

test("unknown create outcomes reconcile only one exact reference and carrier match", async () => {
  const request = async (_config, operation, _body, query) => {
    assert.equal(operation, "list");
    assert.deepEqual(query, { viewpoint: "all", limit: "100", page: "1", sort: "create_date" });
    return envelope(200, {
      data: [
        { reference_no: "SHP-1", carrier_code: "EMS_SPEED", tracking_number: "EE123456789TH", status: "waiting", update_date: "2026-09-10T01:00:00+07:00" },
        { reference_no: "SHP-1", carrier_code: "FLASH_EXPRESS_SPEED", tracking_number: "TH9999999999" },
        { reference_no: "OTHER", carrier_code: "EMS_SPEED", tracking_number: "EE000000000TH" },
      ],
    }, "request-list");
  };
  assert.deepEqual(await reconcileCreatedShipment(config, {
    externalId: "uuid-1", referenceNo: "SHP-1", carrierCode: "EMS_SPEED",
  }, request), {
    trackingNumber: "EE123456789TH",
    status: "waiting",
    updatedAt: "2026-09-10T01:00:00+07:00",
    requestId: "request-list",
  });

  const ambiguous = async () => envelope(200, { data: [
    { reference_no: "SHP-1", carrier_code: "EMS_SPEED", tracking_number: "EE123456789TH" },
    { reference_no: "SHP-1", carrier_code: "EMS_SPEED", tracking_number: "EE987654321TH" },
  ] });
  assert.equal(await reconcileCreatedShipment(config, {
    externalId: "uuid-1", referenceNo: "SHP-1", carrierCode: "EMS_SPEED",
  }, ambiguous), null);
});

test("connection test performs read-only catalogue, address and price checks", async () => {
  const operations = [];
  const request = async (_config, operation, body, query) => {
    operations.push({ operation, body, query });
    if (operation === "carriers")
      return envelope(200, { data: [
        { code: "KEX_SPEED", name: "KEX Express" },
        { code: "EMS_SPEED", name: "Thailand Post EMS" },
      ] }, "carrier-request");
    if (operation === "address") return envelope(200, { data: [] }, "address-request");
    if (operation === "quote")
      return envelope(200, { data: [{ carrier_code: "EMS_SPEED", total: "35.0000" }] }, "quote-request");
    throw new Error(`unexpected mutation ${operation}`);
  };
  const result = await testProviderConnection({ ...config, mutationsEnabled: false }, {
    merchantCode: "MC00000001",
    billingMode: "unconfirmed",
    origin: { county: "แพรกษาใหม่", city: "เมืองสมุทรปราการ", state: "สมุทรปราการ", postcode: "10280" },
  }, request);
  assert.deepEqual(operations.map((entry) => entry.operation), ["carriers", "address", "quote"]);
  assert.ok(operations.every((entry) => !["create", "cancel"].includes(entry.operation)));
  assert.equal(operations[1].query.carrier_code, "THAIPOST");
  assert.deepEqual(operations[2].body.carriers_code, ["KEX_SPEED", "EMS_SPEED"]);
  assert.equal(result.hmac.ok, true);
  assert.equal(result.hmac.message, "signed_request_accepted");
  assert.equal(result.merchant.ok, true);
  assert.equal(result.merchant.message, "configured_credentials_accepted");
  assert.equal(result.carriers.count, 2);
  assert.equal(result.rate_test.carrier_code, "EMS_SPEED");
  assert.equal(result.rate_test.total, "35.0000");
  assert.equal(result.blockers.billing, true);
  assert.equal(result.blockers.mutations, true);
  assert.equal(result.blockers.wallet, null);
  assert.equal(result.blockers.carrier, null);
  assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes(config.secret));
});

test("connection test does not claim HMAC or merchant verification after provider rejection", async () => {
  const request = async (_config, operation) => {
    assert.equal(operation, "carriers");
    return {
      status: 401,
      ok: false,
      data: { code: "ERROR_AUTH" },
      requestId: "request-rejected",
      code: "ERROR_AUTH",
      message: "credentials rejected",
    };
  };
  const result = await testProviderConnection({ ...config, mutationsEnabled: false }, {
    merchantCode: "MC00000001",
    billingMode: "confirmed",
    origin: { county: "แพรกษาใหม่", city: "เมืองสมุทรปราการ", state: "สมุทรปราการ", postcode: "10280" },
  }, request);

  assert.equal(result.hmac.ok, false);
  assert.equal(result.hmac.message, "generated_locally_not_verified");
  assert.equal(result.merchant.ok, false);
  assert.equal(result.merchant.message, "configured_not_verified");
  assert.equal(result.carriers.ok, false);
  assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes(config.secret));
});

test("connection test returns only safe failure enums, never raw provider diagnostics", async () => {
  const rawCarrier = "RAW carrier failure for customer 0814420000";
  const rejected = await testProviderConnection({ ...config, mutationsEnabled: false }, {
    merchantCode: "MC00000001",
    billingMode: "confirmed",
    origin: { county: "แพรกษาใหม่", city: "เมืองสมุทรปราการ", state: "สมุทรปราการ", postcode: "10280" },
  }, async () => ({
    status: 403,
    ok: false,
    data: { code: "PRIVATE_AUTH_CODE", message: rawCarrier },
    requestId: "private-request-id",
    code: "PRIVATE_AUTH_CODE",
    message: rawCarrier,
  }));
  assert.equal(rejected.carriers.message, "provider_authentication_failed");
  assert.equal(rejected.rate_test.message, undefined);
  assert.ok(rejected.blockers.details.every((detail) => /^[a-z_]+(?::[a-z_]+)?$/.test(detail)));
  for (const raw of [rawCarrier, "PRIVATE_AUTH_CODE", "private-request-id"])
    assert.equal(JSON.stringify(rejected).includes(raw), false);

  const rawAddress = "RAW address gateway detail: secret tenant path";
  const rawQuote = "RAW quote validation for telephone 0814420000";
  const checked = await testProviderConnection({ ...config, mutationsEnabled: false }, {
    merchantCode: "MC00000001",
    billingMode: "confirmed",
    origin: { county: "แพรกษาใหม่", city: "เมืองสมุทรปราการ", state: "สมุทรปราการ", postcode: "10280" },
  }, async (_config, operation) => {
    if (operation === "carriers") return envelope(200, { data: [{ code: "EMS_SPEED" }] });
    if (operation === "address") return {
      status: 503, ok: false, data: { code: "PRIVATE_ADDRESS_CODE", message: rawAddress },
      requestId: "private-address-id", code: "PRIVATE_ADDRESS_CODE", message: rawAddress,
    };
    if (operation === "quote") return {
      status: 400, ok: false, data: { code: "PRIVATE_QUOTE_CODE", message: rawQuote },
      requestId: "private-quote-id", code: "PRIVATE_QUOTE_CODE", message: rawQuote,
    };
    throw new Error(`unexpected operation ${operation}`);
  });
  assert.ok(checked.blockers.details.includes("address_check_failed:provider_unreachable"));
  assert.equal(checked.rate_test.message, "invalid_phone");
  assert.ok(checked.blockers.details.every((detail) => /^[a-z_]+(?::[a-z_]+)?$/.test(detail)));
  for (const raw of [rawAddress, rawQuote, "PRIVATE_ADDRESS_CODE", "PRIVATE_QUOTE_CODE", "private-address-id", "private-quote-id"])
    assert.equal(JSON.stringify(checked).includes(raw), false);
});

test("successful read checks do not claim production readiness while wallet and carrier binding are unknown", async () => {
  const request = async (_config, operation) => {
    if (operation === "carriers")
      return envelope(200, { data: [{ code: "EMS_SPEED" }] });
    if (operation === "address") return envelope(200, { data: [] });
    if (operation === "quote")
      return envelope(200, { data: [{ carrier_code: "EMS_SPEED", total: "35.0000" }] });
    throw new Error(`unexpected mutation ${operation}`);
  };
  const result = await testProviderConnection({ ...config, mutationsEnabled: true }, {
    merchantCode: "MC00000001",
    billingMode: "prepaid",
    origin: { county: "แพรกษาใหม่", city: "เมืองสมุทรปราการ", state: "สมุทรปราการ", postcode: "10280" },
  }, request);

  assert.equal(result.hmac.ok, true);
  assert.equal(result.rate_test.ok, true);
  assert.equal(result.blockers.billing, false);
  assert.equal(result.blockers.mutations, false);
  assert.equal(result.blockers.wallet, null);
  assert.equal(result.blockers.carrier, null);
  assert.equal(result.ready, false);
});
