// PromptSpeed Open API V3 provider transport. No credentials or provider response bodies are logged.
export interface ProviderConfig {
  environment: "uat" | "production";
  appId: string;
  secret: string;
  specConfirmed: boolean;
  readsEnabled: boolean;
  mutationsEnabled: boolean;
}

export interface ProviderResponse {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
  requestId: string | null;
  code: string | null;
  message: string | null;
}

export interface ProviderArea {
  county: string;
  city: string;
  state: string;
  postcode: string;
}

export interface ProviderConnectionResult {
  environment: ProviderConfig["environment"];
  checked_at: string;
  hmac: { ok: boolean; message?: string };
  merchant: { ok: boolean; code?: string; message?: string };
  carriers: { ok: boolean; count: number; message?: string };
  rate_test: {
    ok: boolean;
    carrier_code?: string;
    total?: string;
    currency?: string;
    message?: string;
  };
  blockers: {
    billing: boolean;
    wallet: boolean | null;
    carrier: boolean | null;
    mutations: boolean;
    details?: string[];
  };
  ready: boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const text = (value: unknown, max = 300) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
    : "";
const validTracking = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9-]{5,80}$/.test(value);
const successStatus = (status: number) => status >= 200 && status < 300;
export const providerBase = (e: ProviderConfig["environment"]) =>
  e === "production"
    ? "https://openapi.promptspeed.co.th"
    : "https://openapi-uat.promptspeed.co.th";
export async function signQuery(
  appId: string,
  secret: string,
  query: Record<string, string | string[]>,
  timestamp = Date.now(),
): Promise<URLSearchParams> {
  if (["key", "timestamp", "signature"].some((k) => k in query))
    throw new Error("reserved_query_key");
  const key = btoa(`${timestamp}-${appId}`);
  const signed: Record<string, string | string[]> = {
    ...query,
    key,
    timestamp: String(timestamp),
  };
  const base =
    "secret=" +
    secret +
    Object.keys(signed)
      .sort()
      .map((k) =>
        (Array.isArray(signed[k]) ? signed[k] : [signed[k]])
          .map((v) => `${k}=${v}`)
          .join(""),
      )
      .join("");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(base),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const params = new URLSearchParams();
  for (const [k, values] of Object.entries(signed))
    for (const v of Array.isArray(values) ? values : [values])
      params.append(k, v);
  params.set("signature", signature);
  return params;
}
const operations = {
  carriers: ["GET", "/api/v3/carrier/list", false],
  address: ["GET", "/api/v3/shipment/check-address", false],
  quote: ["POST", "/api/v3/shipment/check-price", false],
  create: ["POST", "/api/v3/shipment", true],
  print: ["POST", "/api/v3/shipment/print", false],
  list: ["GET", "/api/v3/shipment", false],
  cancel: ["PUT", "/api/v3/shipment/cancel/", true],
} as const;
export type ProviderOperation = keyof typeof operations;
export function assertProviderReady(
  config: ProviderConfig,
  mutation: boolean,
): void {
  if (
    !config.specConfirmed ||
    !config.readsEnabled ||
    !config.appId ||
    !config.secret ||
    (mutation && !config.mutationsEnabled)
  )
    throw new Error("provider_not_ready");
}

function redactedMessage(value: unknown, secrets: string[]): string | null {
  let message = text(value);
  if (!message) return null;
  for (const secret of secrets.filter((item) => item.length >= 4))
    message = message.split(secret).join("[redacted]");
  message = message.replace(
    /\b(key|signature|secret)=([^\s&]+)/gi,
    "$1=[redacted]",
  );
  return message;
}

export function parseProviderResponse(
  status: number,
  raw: string,
  secrets: string[] = [],
): ProviderResponse {
  if (raw.length > 2_000_000) throw new Error("provider_response_invalid");
  const source = raw.replace(/^\uFEFF/, "").trim();
  let parsed: unknown = {};
  if (source) {
    try {
      parsed = JSON.parse(source);
    } catch {
      if (successStatus(status)) throw new Error("provider_response_invalid");
      return {
        status,
        ok: false,
        data: {},
        requestId: null,
        code: `HTTP_${status}`,
        message: `PromptSpeed HTTP ${status}`,
      };
    }
  }
  const data = Array.isArray(parsed) ? { data: parsed } : record(parsed);
  if (source && !Object.keys(data).length && successStatus(status))
    throw new Error("provider_response_invalid");
  const rawCode = data.code;
  const code = typeof rawCode === "string" || typeof rawCode === "number"
    ? text(String(rawCode), 100) || null
    : null;
  const errorEnvelope =
    (typeof rawCode === "string" && /^(?:ERR|ERROR|FAIL)/i.test(rawCode)) ||
    data.success === false ||
    String(data.status ?? "").toLowerCase() === "error";
  return {
    status,
    ok: successStatus(status) && !errorEnvelope,
    data,
    requestId: text(data.request_id, 100) || null,
    code,
    message: redactedMessage(data.message, secrets),
  };
}

export async function requestProvider(
  config: ProviderConfig,
  operation: ProviderOperation,
  body?: unknown,
  query: Record<string, string | string[]> = {},
  tracking?: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<ProviderResponse> {
  const [method, route, mutation] = operations[operation];
  assertProviderReady(config, mutation);
  if (
    operation === "cancel" &&
    (!tracking || !validTracking(tracking))
  )
    throw new Error("invalid_tracking");
  const params = await signQuery(config.appId, config.secret, query);
  const url =
    providerBase(config.environment) +
    route +
    (operation === "cancel" ? encodeURIComponent(tracking!) : "") +
    "?" +
    params;
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      redirect: "error",
      signal,
      headers: {
        Accept: "application/json, text/plain;q=0.9",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    )
      throw new Error("provider_timeout");
    throw new Error("provider_unreachable");
  }
  return parseProviderResponse(
    response.status,
    await response.text(),
    [config.appId, config.secret, params.get("key") ?? "", params.get("signature") ?? ""],
  );
}

export const providerRows = (response: ProviderResponse): unknown[] =>
  response.ok && Array.isArray(response.data.data) ? response.data.data : [];

export function providerCreateResult(response: ProviderResponse): {
  trackingNumber: string;
  charge: string | null;
  walletBalance: string | null;
  requestId: string | null;
} | null {
  if (!response.ok) return null;
  const data = record(response.data.data);
  if (!validTracking(data.tracking_number)) return null;
  return {
    trackingNumber: data.tracking_number,
    charge: text(data.charge, 50) || null,
    walletBalance: text(data.wallet_balance, 50) || null,
    requestId: response.requestId,
  };
}

const PROVIDER_PDF_PREFIX = "data:application/pdf;base64,";
const MAX_PROVIDER_PDF_BYTES = 1_400_000;

function safePrintLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (link.startsWith(PROVIDER_PDF_PREFIX)) {
    const encoded = link.slice(PROVIDER_PDF_PREFIX.length);
    if (
      !encoded.startsWith("JVBERi0") ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ) return null;
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const byteLength = encoded.length / 4 * 3 - padding;
    return byteLength <= MAX_PROVIDER_PDF_BYTES ? link : null;
  }
  if (link.length > 2_000) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function providerPrintLink(
  response: ProviderResponse,
  expectedTracking?: string,
): string | null {
  if (!response.ok) return null;
  const providerData = response.data.data;
  let rows = Array.isArray(providerData)
    ? providerData.map(record)
    : [record(providerData)];
  if (!Array.isArray(providerData) && !rows[0].link)
    rows.push(response.data);
  if (expectedTracking) {
    const exact = rows.filter((row) => row.tracking_number === expectedTracking);
    rows = exact.length
      ? exact
      : rows.length === 1 && !text(rows[0].tracking_number, 80)
        ? rows
        : [];
  }
  for (const row of rows) {
    const link = safePrintLink(row.link);
    if (link) return link;
  }
  return null;
}

export function providerCancelAccepted(response: ProviderResponse): boolean {
  if (!response.ok) return false;
  const status = text(record(response.data.data).status, 40).toLowerCase();
  const message = text(response.data.message, 40).toLowerCase();
  return ["ok", "canceled", "cancelled"].includes(status) ||
    (response.code === "200" && message === "success");
}

export function providerDefinitiveRejection(
  response: ProviderResponse,
): boolean {
  if (
    response.ok || response.status < 400 || response.status >= 500 ||
    [408, 409, 425, 429].includes(response.status)
  ) return false;
  // Only a parsed provider envelope is definitive. A proxy/plain-text 4xx is
  // still ambiguous because it does not prove that PromptSpeed rejected it.
  return Object.keys(response.data).length > 0 &&
    (!!response.code || !!response.message || response.data.success === false);
}

export interface ReconciledShipment {
  trackingNumber: string;
  status: string | null;
  updatedAt: string | null;
  requestId: string | null;
}

export async function reconcileCreatedShipment(
  config: ProviderConfig,
  expected: { externalId: string; referenceNo: string; carrierCode: string },
  request: typeof requestProvider = requestProvider,
): Promise<ReconciledShipment | null> {
  // V3 documents list pagination and exact reference_no in list rows. It does not
  // document searching by external_id/reference_no, so inspect only the bounded
  // latest page and accept exactly one exact identifier + carrier match.
  const response = await request(config, "list", undefined, {
    viewpoint: "all",
    limit: "100",
    page: "1",
    sort: "create_date",
  });
  const matches = providerRows(response).map(record).filter((row) =>
    row.carrier_code === expected.carrierCode &&
    (
      (text(row.external_id, 200) !== "" && row.external_id === expected.externalId) ||
      row.reference_no === expected.referenceNo
    ) &&
    validTracking(row.tracking_number)
  );
  const unique = [...new Map(matches.map((row) => [row.tracking_number, row])).values()];
  if (unique.length !== 1) return null;
  const row = unique[0];
  return {
    trackingNumber: row.tracking_number as string,
    status: text(row.status, 40) || null,
    updatedAt: text(row.update_date ?? row.updated, 100) || null,
    requestId: response.requestId,
  };
}

const providerArea = (value: Partial<ProviderArea>): ProviderArea => ({
  county: text(value.county, 100),
  city: text(value.city, 100),
  state: text(value.state, 100),
  postcode: text(value.postcode, 5),
});
const completeArea = (value: ProviderArea) =>
  !!value.county && !!value.city && !!value.state && /^\d{5}$/.test(value.postcode);
const safeFailure = (error: unknown) => {
  const code = error instanceof Error ? error.message : "provider_rejected";
  return [
    "provider_not_ready",
    "provider_timeout",
    "provider_unreachable",
    "provider_response_invalid",
  ].includes(code) ? code : "provider_rejected";
};

export async function testProviderConnection(
  config: ProviderConfig,
  input: {
    merchantCode: string;
    billingMode: string;
    origin: Partial<ProviderArea>;
  },
  request: typeof requestProvider = requestProvider,
): Promise<ProviderConnectionResult> {
  const details = [
    "wallet_unknown: Open API V3 has no balance/readiness endpoint",
    "carrier_unknown: carrier/list is a global catalogue, not merchant mapping proof",
    "merchant_code_not_verified: read endpoints authenticate credentials but do not accept merchant_code",
  ];
  let hmac: ProviderConnectionResult["hmac"] = { ok: false };
  const merchantCode = text(input.merchantCode, 100);
  let merchant: ProviderConnectionResult["merchant"] = merchantCode
    ? { ok: false, code: merchantCode, message: "configured_not_verified" }
    : { ok: false, message: "merchant_code_missing" };
  let carriers: ProviderConnectionResult["carriers"] = { ok: false, count: 0 };
  let rateTest: ProviderConnectionResult["rate_test"] = { ok: false };
  let addressOk = false;
  try {
    assertProviderReady(config, false);
    const signed = await signQuery(config.appId, config.secret, { limit: "1" });
    hmac = {
      ok: false,
      message: /^[a-f0-9]{64}$/.test(signed.get("signature") ?? "")
        ? "generated_locally_not_verified"
        : "signature_generation_failed",
    };
    const carrierResponse = await request(config, "carriers", undefined, {
      limit: "100",
    });
    const carrierRows = providerRows(carrierResponse).map(record).filter((row) =>
      /^[A-Za-z0-9_&-]{1,80}$/.test(text(row.code, 80))
    );
    const carrierCodes = [...new Set(
      carrierRows.map((row) => text(row.code, 80)).filter(Boolean),
    )].slice(0, 100);
    if (carrierResponse.ok) {
      hmac = { ok: true, message: "signed_request_accepted" };
      if (merchantCode)
        merchant = {
          ok: true,
          code: merchantCode,
          message: "configured_credentials_accepted",
        };
    }
    carriers = carrierResponse.ok && carrierCodes.length
      ? { ok: true, count: carrierCodes.length, message: "global_catalog_only" }
      : {
        ok: false,
        count: 0,
        message: carrierResponse.code ?? carrierResponse.message ??
          `HTTP_${carrierResponse.status}`,
      };
    const selected = text(
      carrierCodes.find((code) => code === "EMS_SPEED") ?? carrierCodes[0],
      80,
    );
    const origin = providerArea(input.origin);
    if (selected && completeArea(origin)) {
      const addressResponse = await request(config, "address", undefined, {
        postcode: origin.postcode,
        // PromptSpeed's V3 check-address example uses THAIPOST while its
        // quote/create service code is EMS_SPEED.
        carrier_code: selected === "EMS_SPEED" ? "THAIPOST" : selected,
        limit: "10",
      });
      addressOk = addressResponse.ok;
      if (!addressOk)
        details.push(
          `address_check_failed:${addressResponse.code ?? `HTTP_${addressResponse.status}`}`,
        );
      const quoteResponse = await request(config, "quote", {
        box_width: 10,
        box_height: 10,
        box_length: 10,
        box_weight: 100,
        carriers_code: carrierCodes,
        origin,
        destination: origin,
      });
      const quoted = providerRows(quoteResponse).map(record).find((row) =>
        carrierCodes.includes(text(row.carrier_code, 80)) &&
        /^\d{1,9}(?:\.\d{1,4})?$/.test(String(row.total ?? ""))
      );
      rateTest = quoted
        ? {
          ok: true,
          carrier_code: text(quoted.carrier_code, 80),
          total: String(quoted.total),
          currency: "THB",
          message: "synthetic_same_address_quote",
        }
        : {
          ok: false,
          carrier_code: selected,
          message: quoteResponse.code ?? quoteResponse.message ??
            `HTTP_${quoteResponse.status}`,
        };
    } else {
      details.push(selected ? "origin_incomplete" : "carrier_catalog_empty");
    }
  } catch (error) {
    const message = safeFailure(error);
    if (!hmac.message) hmac.message = message;
    if (!carriers.message) carriers.message = message;
    if (!rateTest.message) rateTest.message = message;
  }
  const blockers = {
    billing: input.billingMode === "unconfirmed",
    wallet: null,
    carrier: null,
    mutations: !config.mutationsEnabled,
    details,
  } satisfies ProviderConnectionResult["blockers"];
  return {
    environment: config.environment,
    checked_at: new Date().toISOString(),
    hmac,
    merchant,
    carriers,
    rate_test: rateTest,
    blockers,
    ready: hmac.ok && merchant.ok && carriers.ok && addressOk && rateTest.ok &&
      !blockers.billing && blockers.wallet === false &&
      blockers.carrier === false && !blockers.mutations,
  };
}
