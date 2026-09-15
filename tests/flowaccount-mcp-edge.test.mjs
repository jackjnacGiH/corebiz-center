import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLOWACCOUNT_MCP_ENDPOINT,
  FlowAccountSafeError,
  McpStreamableClient,
  assertExpectedCompany,
  buildAuthorizationUrl,
  buildReadToolArguments,
  buildSalesDocumentDetailArguments,
  constantTimeEqual,
  createPkcePair,
  discoverCurrentCompany,
  discoverFlowAccountOAuth,
  discoverPriceReadTools,
  discoverSalesDocumentDetailTool,
  fetchWithRetry,
  isAllowedReadToolName,
  isValidPkceVerifier,
  hydrateSalesDocumentDetails,
  normalizePriceGeneration,
  normalizeTargetTaxIds,
  paginateReadTool,
  prefilterEligibleDocumentSummaries,
  readCompletePriceSource,
  parseMcpWireText,
  redactSensitiveText,
  registerOAuthClient,
  rollingDateWindow,
  sha256Hex,
  trustedReturnUrl,
  validateConsumedOAuthState,
  verifiedTargetTaxByContactId,
} from "../supabase/functions/_shared/flowaccount-mcp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function tool(name, properties = {}) {
  return { name, description: `read ${name}`, inputSchema: { type: "object", properties } };
}

const cursorFields = { cursor: { type: "string" }, fields: { type: "array" }, page: { type: "number" } };
const toolSet = [
  tool("contacts__list", { ...cursorFields, contact_type: { type: "string" } }),
  tool("product__list", { ...cursorFields, summary_only: { type: "boolean" } }),
  tool("sales__list_quotations", { ...cursorFields, period: { type: "string" } }),
  tool("sales__list_tax_invoices", { ...cursorFields, period: { type: "string" } }),
  tool("sales__list_cash_invoices", { ...cursorFields, period: { type: "string" } }),
];
const companyTool = tool("company__list", { token: { type: "string" } });
const detailTool = tool("sales__get_document", {
  document_type: { type: "string" },
  record_id: { type: "number" },
  fields: { type: "array" },
  view: { type: "string" },
});

test("OAuth state and PKCE helpers produce bounded values and validate consumed state shape", async () => {
  const pair = await createPkcePair();
  assert.equal(isValidPkceVerifier(pair.verifier), true);
  assert.match(pair.challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.match(await sha256Hex("state-value"), /^[a-f0-9]{64}$/);
  assert.deepEqual(validateConsumedOAuthState({
    state_id: "9d539457-a43b-4861-a65d-0f5f72ea0b49",
    company_key: "jnac-thailand",
    code_verifier: pair.verifier,
    redirect_uri: "https://example.supabase.co/functions/v1/flowaccount-mcp-oauth-callback",
  }).company_key, "jnac-thailand");
  assert.throws(() => validateConsumedOAuthState({
    state_id: "id",
    company_key: "jnac-thailand",
    code_verifier: pair.verifier,
    redirect_uri: "https://example.test/callback",
    access_token: "must-never-appear",
  }), /oauth_state_expired/);
});

test("OAuth discovery, dynamic registration, and authorization URL use official metadata and S256", async () => {
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("oauth-protected-resource")) {
      return Response.json({
        resource: "https://mcp.flowaccount.com",
        authorization_servers: ["https://mcp.flowaccount.com"],
      });
    }
    if (String(url).endsWith("oauth-authorization-server")) {
      return Response.json({
        issuer: "https://mcp.flowaccount.com",
        authorization_endpoint: "https://mcp.flowaccount.com/oauth/authorize",
        token_endpoint: "https://mcp.flowaccount.com/oauth/token",
        registration_endpoint: "https://mcp.flowaccount.com/oauth/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["openid", "profile", "flowaccount-api", "offline_access"],
      });
    }
    if (String(url).endsWith("oauth/register")) {
      return Response.json({ client_id: "dynamic-client" }, { status: 201 });
    }
    throw new Error("unexpected URL");
  };
  const metadata = await discoverFlowAccountOAuth(fakeFetch);
  const redirectUri = "https://example.supabase.co/functions/v1/flowaccount-mcp-oauth-callback";
  const registered = await registerOAuthClient(fakeFetch, metadata, redirectUri);
  assert.equal(registered.clientId, "dynamic-client");
  const registrationBody = JSON.parse(requests.at(-1).init.body);
  assert.equal(registrationBody.token_endpoint_auth_method, "none");
  assert.deepEqual(registrationBody.redirect_uris, [redirectUri]);

  const pair = await createPkcePair();
  const state = "A".repeat(43);
  const authorization = new URL(buildAuthorizationUrl(metadata, {
    clientId: registered.clientId,
    redirectUri,
    state,
    codeChallenge: pair.challenge,
  }));
  assert.equal(authorization.origin, "https://mcp.flowaccount.com");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("resource"), "https://mcp.flowaccount.com");
  assert.equal(authorization.searchParams.get("state"), state);
});

test("redaction and constant-time comparison do not expose credential material", () => {
  const secret = "refresh-secret-123";
  const redacted = redactSensitiveText(
    `Bearer abc.def access_token=token123 refresh_token=${secret}&code=oauth-code`,
    [secret],
  );
  assert.doesNotMatch(redacted, /abc\.def|token123|refresh-secret-123|oauth-code/);
  assert.match(redacted, /\[REDACTED\]/);
  assert.equal(constantTimeEqual("same-key", "same-key"), true);
  assert.equal(constantTimeEqual("same-key", "same-key-x"), false);
});

test("MCP wire parser accepts JSON and multi-event SSE, and rejects malformed provider text", () => {
  assert.deepEqual(parseMcpWireText('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), [
    { jsonrpc: "2.0", id: 1, result: { ok: true } },
  ]);
  const sse = [
    "event: message",
    'data: {"jsonrpc":"2.0","id":1,"result":{"page":1}}',
    "",
    "event: message",
    'data: {"jsonrpc":"2.0","id":2,"result":{"page":2}}',
    "",
  ].join("\n");
  assert.equal(parseMcpWireText(sse, "text/event-stream").length, 2);
  assert.throws(() => parseMcpWireText("provider stack trace"), /mcp_protocol_error/);
});

test("Streamable HTTP client initializes a session and parses an SSE tools/list response", async () => {
  const seen = [];
  const fakeFetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    seen.push({ request, headers: init.headers });
    if (request.method === "initialize") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "test" } },
      }), { headers: { "Content-Type": "application/json", "Mcp-Session-Id": "session-1" } });
    }
    if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (request.method === "tools/list") {
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [companyTool, detailTool, ...toolSet] } })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    throw new Error("unexpected MCP request");
  };
  const client = new McpStreamableClient({ fetchImpl: fakeFetch, endpoint: FLOWACCOUNT_MCP_ENDPOINT, accessToken: "access" });
  await client.initialize();
  assert.equal((await client.listTools()).length, 7);
  assert.equal(seen[1].headers["Mcp-Session-Id"], "session-1");
  assert.equal(seen[2].headers.Authorization, "Bearer access");
});

test("Streamable HTTP client accepts only the exact JSON-RPC response id from multi-event SSE", async () => {
  let call = 0;
  const fakeFetch = async (_url, init) => {
    call += 1;
    const request = JSON.parse(init.body);
    if (call === 1) {
      return new Response([
        'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}',
        "",
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id + 50, result: { wrong: true } })}`,
        "",
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { exact: true } })}`,
        "",
      ].join("\n"), { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response([
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id + 50, result: { wrong: true } })}`,
      "",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":2}}',
      "",
    ].join("\n"), { headers: { "Content-Type": "text/event-stream" } });
  };
  const client = new McpStreamableClient({
    fetchImpl: fakeFetch,
    endpoint: FLOWACCOUNT_MCP_ENDPOINT,
    accessToken: "access",
  });
  assert.deepEqual(await client.request("tools/list"), { exact: true });
  await assert.rejects(client.request("tools/list"), /mcp_protocol_error/);
});

test("retry is bounded to 429/5xx and pagination follows each opaque cursor once", async () => {
  let attempts = 0;
  const response = await fetchWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
    if (attempts === 2) return new Response(null, { status: 503 });
    return Response.json({ ok: true });
  }, "https://example.test", {}, { sleep: async () => undefined });
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);

  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      const cursor = args.cursor;
      const structuredContent = cursor
        ? { data: { list: [{ id: 2 }], count: 2 }, pagination: { hasMore: false, nextCursor: null } }
        : { data: { list: [{ id: 1 }], count: 2 }, pagination: { hasMore: true, nextCursor: "opaque-2" } };
      return { structuredContent };
    },
  };
  const records = await paginateReadTool(client, toolSet[0], { fields: ["id"], page: 1 });
  assert.deepEqual(records.map((record) => record.id), [1, 2]);
  assert.equal(calls[1].args.cursor, "opaque-2");
  assert.equal("page" in calls[1].args, false);
});

test("tool discovery selects only required read tools and rejects every write-shaped invocation", () => {
  const selected = discoverPriceReadTools([
    ...toolSet,
    tool("contacts__create", {}),
    tool("product__update", {}),
    tool("sales__void_tax_invoice", {}),
    tool("sales__send_quotation", {}),
  ]);
  assert.equal(selected.contacts, undefined);
  assert.equal(selected.products, undefined);
  assert.equal(selected.quotations.name, "sales__list_quotations");
  assert.equal(selected.tax_invoices.name, "sales__list_tax_invoices");
  assert.equal(selected.cash_invoices.name, "sales__list_cash_invoices");
  assert.equal(discoverSalesDocumentDetailTool([detailTool, ...toolSet]).name, "sales__get_document");
  assert.equal(isAllowedReadToolName("sales__get_document"), true);
  assert.equal(isAllowedReadToolName("contacts__list"), false);
  assert.equal(isAllowedReadToolName("product__list"), false);
  assert.throws(
    () => discoverPriceReadTools(toolSet.filter((candidate) => candidate.name !== "sales__list_cash_invoices")),
    /mcp_read_tools_missing/,
  );
  for (const name of ["contacts__create", "product__update", "sales__void_tax_invoice", "sales__send_quotation"]) {
    assert.equal(isAllowedReadToolName(name), false);
  }
  const args = buildReadToolArguments(selected.quotations, "quotations", {
    start: "2026-03-17",
    end: "2026-09-13",
  });
  assert.equal(args.period, "2026-03-17_2026-09-13");
  assert.ok(args.fields.includes("contactTaxId"));
  assert.ok(args.fields.includes("documentDate"));
  assert.equal(args.fields.includes("publishedOn"), false);
  assert.equal(args.fields.includes("productItems"), false);
  assert.equal(args.fields.includes("items"), false);
  assert.equal(args.fields.includes("isForeignCurrency"), false);
  assert.equal("token" in args, false);
});

test("sales document detail proves domestic or foreign currency before normalization", async () => {
  const targetTaxId = "0105566000123";
  const args = buildSalesDocumentDetailArguments(detailTool, "cash_invoices", 701);
  assert.equal(args.document_type, "cash_invoice");
  assert.equal(args.record_id, 701);
  assert.ok(args.fields.includes("isForeignCurrency"));
  assert.ok(args.fields.includes("isForeignBase"));
  assert.ok(args.fields.includes("foreignCurrency"));
  assert.ok(args.fields.includes("productItems"));
  assert.equal("token" in args, false);

  const line = {
    productMasterId: 201,
    productCode: "AB-100",
    unitName: "ชิ้น",
    quantity: 1,
    pricePerUnit: 100,
    total: 100,
    discountPerItem: 0,
    discountPerItemValue: 0,
    isVat: true,
    vatRate: 7,
  };
  const details = await hydrateSalesDocumentDetails({
    async callTool(name, detailArgs) {
      assert.equal(name, "sales__get_document");
      const isForeign = detailArgs.record_id === 702;
      return { structuredContent: {
        status: true,
        code: 0,
        data: {
          recordId: detailArgs.record_id,
          publishedOn: "2026-09-01",
          contactId: 101,
          contactTaxId: targetTaxId,
          status: 5,
          isForeignCurrency: isForeign,
          ...(isForeign ? { isForeignBase: true } : {}),
          foreignCurrency: isForeign ? 840 : 0,
          isManualVat: false,
          isVatInclusive: false,
          isVat: true,
          vatRate: 7,
          discount: 0,
          discountPercentage: 0,
          deductionAmount: 0,
          productItems: [line],
        },
      } };
    },
  }, detailTool, [
    { recordId: 701, status: 5, contactId: 101, contactTaxId: targetTaxId },
    { recordId: 702, status: 5, contactId: 101, contactTaxId: targetTaxId },
  ], "cash_invoices", [targetTaxId]);
  assert.equal(details[0].isForeignCurrency, false);
  assert.equal(details[0].isForeignBase, undefined);
  assert.equal(details[1].isForeignCurrency, true);

  const inferredTaxDetails = await hydrateSalesDocumentDetails({
    async callTool(_name, detailArgs) {
      const { contactTaxId: _omittedTaxId, ...withoutTaxId } = details[0];
      return { structuredContent: { status: true, code: 0, data: {
        ...withoutTaxId,
        recordId: detailArgs.record_id,
      } } };
    },
  }, detailTool, [
    { recordId: 703, status: 5, contactId: 101, contactTaxId: targetTaxId },
  ], "cash_invoices", [targetTaxId]);
  assert.equal(inferredTaxDetails[0].contactTaxId, targetTaxId);
});

test("active tax targets are exact, bounded, and applied before document detail reads", async () => {
  const targetTaxId = "0105566000123";
  assert.deepEqual(normalizeTargetTaxIds([targetTaxId]), [targetTaxId]);
  assert.throws(() => normalizeTargetTaxIds(["01055-66000-123"]), /sync_source_incomplete/);
  assert.throws(() => normalizeTargetTaxIds([targetTaxId, targetTaxId]), /sync_source_incomplete/);
  assert.throws(
    () => normalizeTargetTaxIds(Array.from({ length: 101 }, (_, index) => String(index).padStart(13, "0"))),
    /active_customer_limit_exceeded/,
  );

  const summaries = [
    { recordId: 1, publishedOn: "2026-09-01", contactId: 101, contactTaxId: targetTaxId, status: 3 },
    { recordId: 2, publishedOn: "2026-09-01", contactId: 102, contactTaxId: "0105566000999", status: 3 },
    { recordId: 3, publishedOn: "2026-09-01", contactId: 101, contactTaxId: targetTaxId, status: 7 },
  ];
  const filtered = prefilterEligibleDocumentSummaries(summaries, "quotations", [targetTaxId]);
  assert.deepEqual(filtered.candidates.map((item) => item.recordId), [1]);
  assert.equal(filtered.omittedRows, 2);
  const stringStatuses = prefilterEligibleDocumentSummaries([
    { ...summaries[0], status: "approvedAndProcessed", documentDate: "2026-09-01T00:00:00Z", publishedOn: undefined },
    { ...summaries[0], recordId: 4, status: "awaiting", documentDate: "2026-09-01T00:00:00Z", publishedOn: undefined },
  ], "quotations", [targetTaxId]);
  assert.equal(stringStatuses.candidates.length, 1);
  assert.equal(stringStatuses.omittedRows, 1);
  const missingSummaryDate = prefilterEligibleDocumentSummaries([
    { ...summaries[0], publishedOn: undefined, documentDate: null },
  ], "quotations", [targetTaxId]);
  assert.equal(missingSummaryDate.candidates.length, 1);
  assert.equal(missingSummaryDate.omittedRows, 0);
  const unresolved = prefilterEligibleDocumentSummaries(
    [{ ...summaries[0], contactTaxId: null }], "quotations", [targetTaxId], [101],
  );
  assert.equal(unresolved.candidates.length, 0);
  assert.equal(unresolved.unresolved.length, 1);

  const missingTaxOutsideTargetContacts = prefilterEligibleDocumentSummaries(
    [{ ...summaries[0], contactId: 999, contactTaxId: null }], "cash_invoices", [targetTaxId], [101],
  );
  assert.equal(missingTaxOutsideTargetContacts.candidates.length, 0);
  assert.equal(missingTaxOutsideTargetContacts.unresolved.length, 0);
  assert.equal(missingTaxOutsideTargetContacts.omittedRows, 1);

  const exactContactMap = verifiedTargetTaxByContactId([
    { contactId: 101, contactTaxId: targetTaxId },
    { contactId: 101, contactTaxId: targetTaxId },
    { contactId: 102, contactTaxId: targetTaxId },
    { contactId: 102, contactTaxId: "0105566000999" },
  ], [targetTaxId]);
  assert.equal(exactContactMap.get(101), targetTaxId);
  assert.equal(exactContactMap.has(102), false);

  const inboundTax = prefilterEligibleDocumentSummaries(
    [{ ...summaries[0], status: 9 }], "tax_invoices", [targetTaxId],
  );
  const inboundCash = prefilterEligibleDocumentSummaries(
    [{ ...summaries[0], status: "invoiceReceived" }], "cash_invoices", [targetTaxId],
  );
  assert.equal(inboundTax.candidates.length, 0);
  assert.equal(inboundTax.omittedRows, 1);
  assert.equal(inboundCash.candidates.length, 0);
  assert.equal(inboundCash.omittedRows, 1);

  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name.startsWith("sales__list_")) {
        const offset = name.includes("quotations") ? 0 : name.includes("tax_invoices") ? 10 : 20;
        return { structuredContent: {
          data: { list: summaries.map((item) => ({ ...item, recordId: item.recordId + offset })), count: 3 },
          pagination: { hasMore: false, nextCursor: null },
        } };
      }
      if (name === "sales__get_document") {
        return { structuredContent: { status: true, code: 0, data: {
          recordId: args.record_id,
          publishedOn: "2026-09-01",
          modifiedOn: "2026-09-02T00:00:00Z",
          contactId: 101,
          contactTaxId: targetTaxId,
          status: 3,
          statusString: "Approved",
          isForeignCurrency: false,
          foreignCurrency: 0,
          isManualVat: false,
          isVatInclusive: false,
          isVat: true,
          vatRate: 7,
          discount: 0,
          discountPercentage: 0,
          deductionAmount: 0,
          productItems: [{
            productCode: "AB-100", unitName: "ชิ้น", quantity: 1,
            pricePerUnit: 100, total: 100, discountPerItem: 0,
            discountPerItemValue: 0, isVat: true, vatRate: 7,
          }],
        } } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const source = await readCompletePriceSource(
    client,
    [detailTool, ...toolSet],
    { start: "2026-03-17", end: "2026-09-13" },
    [targetTaxId],
  );
  assert.equal(source.quotations.length, 1);
  assert.equal(source.taxInvoices.length, 1);
  assert.equal(source.cashInvoices.length, 1);
  assert.equal(source.prefilteredOmittedRows, 6);
  assert.equal(calls.some((call) => /contacts|product__list/.test(call.name)), false);
  assert.equal(calls.filter((call) => call.name === "sales__get_document").length, 3);

  let emptyCalls = 0;
  const emptySource = await readCompletePriceSource({
    async callTool() {
      emptyCalls += 1;
      throw new Error("provider must not be called for an empty target cohort");
    },
  }, [], { start: "2026-03-17", end: "2026-09-13" }, []);
  assert.deepEqual(emptySource, {
    quotations: [], taxInvoices: [], cashInvoices: [], prefilteredOmittedRows: 0,
  });
  assert.equal(emptyCalls, 0);

  await assert.rejects(
    hydrateSalesDocumentDetails({
      async callTool(_name, args) {
        const result = await client.callTool("sales__get_document", args);
        result.structuredContent.data.contactTaxId = "0105566000999";
        return result;
      },
    }, detailTool, [summaries[0]], "quotations", [targetTaxId]),
    /sync_source_incomplete/,
  );
});

test("one-to-one contact evidence carries verified tax identity into taxless cash documents", async () => {
  const targetTaxId = "0105566000123";
  const calls = [];
  const productItem = {
    productCode: "AB-100", unitName: "ชิ้น", quantity: 1,
    pricePerUnit: 100, total: 100, discountPerItem: 0,
    discountPerItemValue: 0, isVat: true, vatRate: 7,
  };
  const detail = (recordId, status, contactTaxId) => ({
    recordId,
    publishedOn: "2026-09-01",
    modifiedOn: "2026-09-02T00:00:00Z",
    contactId: 101,
    ...(contactTaxId ? { contactTaxId } : {}),
    status,
    isForeignCurrency: false,
    foreignCurrency: 0,
    isManualVat: false,
    isVatInclusive: false,
    isVat: true,
    vatRate: 7,
    discount: 0,
    discountPercentage: 0,
    deductionAmount: 0,
    productItems: [productItem],
  });
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === "sales__list_quotations") {
        return { structuredContent: {
          data: { list: [{
            recordId: 1, documentDate: "2026-09-01T00:00:00Z",
            contactId: 101, contactTaxId: targetTaxId, status: "approved",
          }], count: 1 },
          pagination: { hasMore: false, nextCursor: null },
        } };
      }
      if (name === "sales__list_tax_invoices") {
        return { structuredContent: {
          data: { list: [], count: 0 },
          pagination: { hasMore: false, nextCursor: null },
        } };
      }
      if (name === "sales__list_cash_invoices") {
        return { structuredContent: {
          data: { list: [{
            recordId: 2, documentDate: "2026-09-01T00:00:00Z",
            contactId: 101, contactTaxId: null, status: "paid",
          }], count: 1 },
          pagination: { hasMore: false, nextCursor: null },
        } };
      }
      if (name === "sales__get_document") {
        return { structuredContent: { status: true, code: 0, data:
          args.record_id === 1 ? detail(1, 3, targetTaxId) : detail(2, 5, null),
        } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const source = await readCompletePriceSource(
    client,
    [detailTool, ...toolSet],
    { start: "2026-03-17", end: "2026-09-13" },
    [targetTaxId],
  );
  assert.equal(source.quotations.length, 1);
  assert.equal(source.cashInvoices.length, 1);
  assert.equal(source.cashInvoices[0].contactTaxId, targetTaxId);
  assert.equal(source.prefilteredOmittedRows, 0);
  assert.equal(calls.filter((call) => call.name === "sales__get_document").length, 2);
});

test("current FlowAccount company is discovered read-only and must be exactly one selected tenant", async () => {
  const calls = [];
  const client = {
    async callTool(name, args) {
      calls.push({ name, args });
      return {
        structuredContent: {
          companies: [
            { name: "Other Co.", support_code: "OTHER", is_current: false },
            { name: "J NAC (THAILAND) CO.,LTD.", support_code: "JNAC01", is_current: true },
          ],
          current_company: "J NAC (THAILAND) CO.,LTD.",
        },
      };
    },
  };
  const current = await discoverCurrentCompany(client, [companyTool, ...toolSet]);
  assert.deepEqual(current, {
    providerCompanyId: "JNAC01",
    providerCompanyName: "J NAC (THAILAND) CO.,LTD.",
  });
  assert.deepEqual(calls, [{ name: "company__list", args: {} }]);
  await assert.rejects(
    discoverCurrentCompany({
      async callTool() {
        return { structuredContent: { companies: [
          { name: "A", support_code: "A", is_current: true },
          { name: "B", support_code: "B", is_current: true },
        ] } };
      },
    }, [companyTool]),
    /mcp_tool_ambiguous/,
  );
  assert.equal(
    new FlowAccountSafeError("flowaccount_company_mismatch", 409).code,
    "flowaccount_company_mismatch",
  );
  assert.deepEqual(
    assertExpectedCompany(current, {
      id: "JNAC01",
      name: "J NAC (THAILAND) CO.,LTD.",
    }),
    current,
  );
  assert.throws(
    () => assertExpectedCompany(current, {
      id: "OTHER",
      name: "J NAC (THAILAND) CO.,LTD.",
    }),
    /flowaccount_company_mismatch/,
  );
  assert.throws(
    () => assertExpectedCompany(current, {
      id: "JNAC01",
      name: "Wrong Company",
    }),
    /flowaccount_company_mismatch/,
  );
  assert.throws(() => assertExpectedCompany(current, {}), /oauth_configuration_invalid/);
});

test("normalization uses exact target tax ID, SKU, unit and quantity and excludes unsafe price lines", async () => {
  const window = { start: "2026-03-17", end: "2026-09-13" };
  const base = {
    publishedOn: "2026-09-01",
    modifiedOn: "2026-09-02T03:04:05Z",
    documentSerial: "QT-2026-100",
    contactId: 101,
    contactTaxId: "0105566000123",
    status: 3,
    statusString: "Approved",
    isForeignCurrency: false,
    isForeignBase: false,
    foreignCurrency: 0,
    isManualVat: false,
    isVatInclusive: false,
    isVat: true,
    discountPercentage: 0,
    discountAmount: 0,
    documentDeductionAmount: 0,
  };
  const safeLine = {
    id: 1,
    productMasterId: 201,
    productCode: "ab-100",
    unitName: "ชิ้น",
    quantity: 2,
    pricePerUnit: 100,
    total: 200,
    discountAmount: 0,
  };
  const result = await normalizePriceGeneration({
    targetTaxIds: ["0105566000123"],
    quotations: [
      { ...base, recordId: 501, productItems: [safeLine] },
      { ...base, recordId: 502, status: 7, statusString: "Void", productItems: [safeLine] },
      { ...base, recordId: 503, productItems: [{ ...safeLine, unitName: "กล่อง" }] },
      { ...base, recordId: 504, productItems: [{ ...safeLine, discountPerItemValue: 5, total: 195 }] },
      { ...base, recordId: 505, status: 1, statusString: "Awaiting", productItems: [safeLine] },
      { ...base, recordId: 506, productItems: [{
        ...safeLine,
        netUnitPrice: 95,
        discountAmount: 10,
        total: 190,
      }] },
      { ...base, recordId: 507, discount: 5, productItems: [safeLine] },
    ],
    taxInvoices: [{
      ...base,
      recordId: 601,
      documentSerial: "INV-2026-100",
      status: 5,
      statusString: "Paid",
      isVatInclusive: true,
      vatRate: 7,
      productItems: [{ ...safeLine, pricePerUnit: 107, total: 214 }],
    }, {
      ...base,
      recordId: 602,
      documentSerial: "INV-2026-101",
      status: 9,
      statusString: "InvoiceReceived",
      productItems: [safeLine],
    }],
    cashInvoices: [{
      ...base,
      recordId: 701,
      documentSerial: "CA-2026-100",
      status: 5,
      statusString: "Paid",
      productItems: [safeLine],
    }, {
      ...base,
      recordId: 702,
      documentSerial: "CA-2026-101",
      status: 1,
      statusString: "Awaiting",
      productItems: [safeLine],
    }, {
      ...base,
      recordId: 703,
      documentSerial: "CA-2026-102",
      status: 9,
      statusString: "InvoiceReceived",
      productItems: [safeLine],
    }],
    window,
  });
  assert.equal(result.rows.length, 10);
  assert.equal(result.eligibleRows, 5);
  assert.equal(result.omittedRows, 2);
  const quote = result.rows.find((row) => row.document_record_id === 501);
  const canceled = result.rows.find((row) => row.document_record_id === 502);
  const invoice = result.rows.find((row) => row.document_record_id === 601);
  const draft = result.rows.find((row) => row.document_record_id === 505);
  const explicitNet = result.rows.find((row) => row.document_record_id === 506);
  const cashInvoice = result.rows.find((row) => row.document_record_id === 701);
  const cashDraft = result.rows.find((row) => row.document_record_id === 702);
  const inboundTaxInvoice = result.rows.find((row) => row.document_record_id === 602);
  const inboundCashInvoice = result.rows.find((row) => row.document_record_id === 703);
  assert.equal(quote.source_contact_tax_id, "0105566000123");
  assert.equal(quote.source_sku, "AB-100");
  assert.equal(quote.source_unit, "ชิ้น");
  assert.equal(quote.source_quantity, 2);
  assert.equal(quote.net_unit_price, 100);
  assert.equal("customer_id" in quote, false);
  assert.equal("product_id" in quote, false);
  assert.equal(canceled.eligible, false);
  assert.equal(canceled.eligibility_reason, "status_not_eligible");
  assert.equal(draft.eligible, false);
  assert.equal(draft.eligibility_reason, "status_not_eligible");
  assert.equal(explicitNet.net_unit_price, 95);
  assert.equal(explicitNet.eligible, true);
  assert.equal(invoice.net_unit_price, 100);
  assert.match(cashInvoice.line_key, /^cash_invoice:/);
  assert.equal(cashInvoice.eligible, true);
  assert.equal(cashDraft.eligible, false);
  assert.equal(inboundTaxInvoice.eligible, false);
  assert.equal(inboundTaxInvoice.eligibility_reason, "status_not_eligible");
  assert.equal(inboundCashInvoice.eligible, false);
  assert.equal(inboundCashInvoice.eligibility_reason, "status_not_eligible");
  assert.match(result.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(quote.source_hash, /^[a-f0-9]{64}$/);
});

test("document metric counts the same provider record id separately across document kinds", async () => {
  const window = { start: "2026-03-17", end: "2026-09-13" };
  const base = {
    recordId: 501,
    publishedOn: "2026-09-01",
    modifiedOn: "2026-09-02T03:04:05Z",
    contactId: 101,
    contactTaxId: "0105566000123",
    status: 5,
    isForeignCurrency: false,
    isForeignBase: false,
    foreignCurrency: 0,
    isManualVat: false,
    isVatInclusive: false,
    isVat: true,
    productItems: [{ id: 1, productCode: "AB-100", unitName: "ชิ้น", quantity: 1, pricePerUnit: 100, total: 100 }],
  };
  const result = await normalizePriceGeneration({
    targetTaxIds: ["0105566000123"],
    quotations: [{ ...base, status: 3, documentSerial: "QT-501" }],
    taxInvoices: [{ ...base, documentSerial: "INV-501" }],
    window,
  });
  assert.equal(result.rows.length, 2);
  assert.equal(result.documentCount, 2);
});

test("manual VAT ambiguity, foreign currency, stale documents, and empty anomalies fail closed", async () => {
  const window = rollingDateWindow(new Date("2026-09-13T10:00:00Z"), 180);
  const document = {
    recordId: 3,
    publishedOn: window.end,
    contactId: 1,
    contactTaxId: "0105566000123",
    status: 3,
    isForeignCurrency: false,
    isForeignBase: false,
    foreignCurrency: 0,
    isManualVat: true,
    isVatInclusive: true,
    isVat: true,
    productItems: [{ productId: 2, sku: "SKU", unitName: "EA", quantity: 1, pricePerUnit: 107, total: 107 }],
  };
  const result = await normalizePriceGeneration({
    targetTaxIds: ["0105566000123"],
    quotations: [
      { ...document, recordId: 3, isManualVat: false, isVatInclusive: false },
      { ...document, recordId: 4 },
      {
        ...document,
        recordId: 5,
        isManualVat: false,
        isForeignCurrency: true,
        isForeignBase: true,
        foreignCurrency: 840,
      },
      { ...document, recordId: 6, isManualVat: false, isVatInclusive: false, publishedOn: "2025-01-01" },
    ],
    window,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.omittedRows, 3);
  await assert.rejects(
    normalizePriceGeneration({
      targetTaxIds: ["0105566000123"], quotations: [document], window,
    }),
    /sync_source_incomplete/,
  );
});

test("Edge sources enforce one-time state RPCs, Vault-only tokens, scheduled secret RPC, and safe bodies", () => {
  const start = read("supabase/functions/flowaccount-mcp-oauth-start/index.ts");
  const callback = read("supabase/functions/flowaccount-mcp-oauth-callback/index.ts");
  const sync = read("supabase/functions/flowaccount-price-sync/index.ts");
  assert.match(start, /create_flowaccount_mcp_oauth_state/);
  assert.match(start, /p_state_hash:\s*stateHash/);
  assert.match(start, /p_code_verifier:\s*pkce\.verifier/);
  assert.match(callback, /consume_flowaccount_mcp_oauth_state/);
  assert.match(callback, /p_consumed_at/);
  assert.match(callback, /discoverCurrentCompany\(client, tools\)/);
  assert.match(callback, /FLOWACCOUNT_MCP_EXPECTED_COMPANY_ID/);
  assert.match(callback, /FLOWACCOUNT_MCP_EXPECTED_COMPANY_NAME/);
  assert.match(callback, /assertExpectedCompany\(currentCompany/);
  assert.match(callback, /p_provider_company_id:\s*currentCompany\.providerCompanyId/);
  assert.match(callback, /p_provider_company_name:\s*currentCompany\.providerCompanyName/);
  assert.match(callback, /["']Referrer-Policy["']:\s*["']no-referrer["']/);
  assert.match(callback, /["']Cache-Control["']:\s*["']no-store["']/);
  const callbackDiscovery = callback.indexOf("discoverCurrentCompany(client, tools)");
  const callbackRefreshWrite = callback.indexOf("FLOWACCOUNT_VAULT_NAMES.refreshToken, token.refreshToken");
  const callbackAccessWrite = callback.indexOf("FLOWACCOUNT_VAULT_NAMES.accessToken, token.accessToken");
  const callbackConnected = callback.indexOf('p_status: "connected"');
  assert.ok(callbackDiscovery > 0 && callbackDiscovery < callbackRefreshWrite);
  assert.ok(callback.indexOf("assertExpectedCompany(currentCompany") < callbackRefreshWrite);
  assert.ok(callbackRefreshWrite < callbackAccessWrite && callbackAccessWrite < callbackConnected);
  assert.match(sync, /get_flowaccount_mcp_sync_key/);
  assert.match(sync, /constantTimeEqual\(scheduledKey, expected\)/);
  assert.match(sync, /get_flowaccount_mcp_sync_context/);
  assert.match(sync, /get_flowaccount_active_customer_targets/);
  assert.match(sync, /p_days:\s*180/);
  assert.match(sync, /p_limit:\s*100/);
  assert.doesNotMatch(sync, /flowaccount_mcp_connection_is_connected/);
  assert.match(sync, /p_source:\s*["']mcp["']/);
  assert.doesNotMatch(sync, /p_source:\s*["']flowaccount_mcp["']/);
  assert.match(sync, /flowaccount_sync_in_progress/);
  assert.match(sync, /FlowAccountSafeError\(["']sync_in_progress["'],\s*409\)/);
  assert.match(sync, /currentCompany\.providerCompanyId !== syncContext\.providerCompanyId/);
  assert.match(sync, /currentCompany\.providerCompanyName !== syncContext\.providerCompanyName/);
  assert.match(sync, /throw new FlowAccountSafeError\(["']flowaccount_company_mismatch["']/);
  assert.ok(sync.indexOf("flowaccount_company_mismatch") < sync.indexOf('p_status: "connected"'));
  assert.ok(sync.indexOf("flowaccount_company_mismatch") < sync.indexOf("publish_flowaccount_price_sync_run"));
  assert.match(sync, /client\.listTools\(\)/);
  assert.match(sync, /publish_flowaccount_price_sync_run/);
  assert.ok(sync.indexOf("activeCustomerTargets(admin)") < sync.indexOf("startSyncRun(admin"));
  assert.ok(sync.indexOf("readCompletePriceSource(") < sync.indexOf("publish_flowaccount_price_sync_run"));
  assert.doesNotMatch(`${start}\n${callback}\n${sync}`, /\.from\(["'](?:vault|flowaccount_mcp_oauth_states)/);
  assert.doesNotMatch(`${start}\n${callback}\n${sync}`, /console\.(?:log|error|warn)/);
  assert.doesNotMatch(sync, /tools\/call[^\n]+(?:create|update|delete|void|send)/i);
  for (const source of [start, callback, sync]) {
    assert.doesNotMatch(source, /JSON\.stringify\([^\n]*(?:accessToken|refreshToken|clientSecret)/);
  }
  assert.equal(trustedReturnUrl("https://evil.example/callback", "connected"),
    "https://www.jnac.online/center/settings?flowaccount=connected");
  assert.equal(
    trustedReturnUrl("https://uat.jnac.test/center/settings?tab=integrations", "error", ["uat.jnac.test"]),
    "https://uat.jnac.test/center/settings?tab=integrations&flowaccount=error",
  );
});

test("pagination refuses repeated cursors and incomplete totals", async () => {
  const loopingClient = {
    async callTool() {
      return { structuredContent: { data: { list: [{ id: 1 }] }, pagination: { hasMore: true, nextCursor: "same" } } };
    },
  };
  await assert.rejects(
    paginateReadTool(loopingClient, toolSet[0], { fields: ["id"] }),
    (error) => error instanceof FlowAccountSafeError && error.code === "mcp_pagination_invalid",
  );
  const incompleteClient = {
    async callTool() {
      return { structuredContent: { data: { list: [{ id: 1 }], count: 5 } } };
    },
  };
  await assert.rejects(
    paginateReadTool(incompleteClient, toolSet[0], { fields: ["id"] }),
    /mcp_pagination_incomplete/,
  );
});
