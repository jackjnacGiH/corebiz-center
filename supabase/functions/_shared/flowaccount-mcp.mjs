const encoder = new TextEncoder();

export const FLOWACCOUNT_ORIGIN = "https://mcp.flowaccount.com";
export const FLOWACCOUNT_MCP_ENDPOINT = `${FLOWACCOUNT_ORIGIN}/mcp`;
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-03-26"]);
export const FLOWACCOUNT_SCOPES = [
  "openid",
  "profile",
  "flowaccount-api",
  "offline_access",
];

export const FLOWACCOUNT_VAULT_NAMES = Object.freeze({
  clientId: "FLOWACCOUNT_MCP_CLIENT_ID",
  clientSecret: "FLOWACCOUNT_MCP_CLIENT_SECRET",
  accessToken: "FLOWACCOUNT_MCP_ACCESS_TOKEN",
  refreshToken: "FLOWACCOUNT_MCP_REFRESH_TOKEN",
});

const MAX_PROVIDER_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TOOL_PAGES = 250;
const MAX_TOOL_RECORDS = 50_000;
const MAX_PUBLISH_ROWS = 20_000;
const MAX_DETAIL_DOCUMENTS = 5_000;
const DETAIL_CONCURRENCY = 4;
const MAX_INFERRED_TAX_DETAILS = 100;

const SAFE_ERROR_CODES = new Set([
  "active_customer_limit_exceeded",
  "bad_json",
  "company_key_required",
  "flowaccount_company_mismatch",
  "connection_required",
  "database_rpc_failed",
  "forbidden",
  "invalid_company_key",
  "invalid_oauth_callback",
  "invalid_oauth_state",
  "method_not_allowed",
  "mcp_initialize_failed",
  "mcp_pagination_incomplete",
  "mcp_pagination_invalid",
  "mcp_protocol_error",
  "mcp_read_tools_missing",
  "mcp_tool_ambiguous",
  "mcp_tool_failed",
  "mcp_tool_schema_unsupported",
  "oauth_client_registration_failed",
  "oauth_configuration_invalid",
  "oauth_denied",
  "oauth_metadata_unavailable",
  "oauth_state_create_failed",
  "oauth_state_expired",
  "oauth_token_exchange_failed",
  "provider_rate_limited",
  "provider_timeout",
  "provider_unavailable",
  "sync_publish_failed",
  "sync_in_progress",
  "sync_row_limit_exceeded",
  "sync_source_incomplete",
  "unauthorized",
]);

export class FlowAccountSafeError extends Error {
  constructor(code, status = 500) {
    const safeCode = SAFE_ERROR_CODES.has(code) ? code : "provider_unavailable";
    super(safeCode);
    this.name = "FlowAccountSafeError";
    this.code = safeCode;
    this.status = status;
  }
}

export function safeErrorCode(error, fallback = "provider_unavailable") {
  if (error instanceof FlowAccountSafeError && SAFE_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return SAFE_ERROR_CODES.has(fallback) ? fallback : "provider_unavailable";
}

export function safeErrorStatus(error, fallback = 500) {
  return error instanceof FlowAccountSafeError && Number.isInteger(error.status)
    ? error.status
    : fallback;
}

export function redactSensitiveText(value, explicitSecrets = []) {
  let text = String(value ?? "");
  for (const secret of explicitSecrets) {
    const candidate = String(secret ?? "");
    if (candidate) text = text.split(candidate).join("[REDACTED]");
  }
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:access_token|refresh_token|client_secret|code_verifier)["']?\s*[:=]\s*["']?)[^\s,"'&}]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:code|state)=)[^&\s]+/gi, "$1[REDACTED]");
}

function assertObject(value, code = "provider_unavailable") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FlowAccountSafeError(code, 502);
  }
  return value;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBase64Url(byteLength = 32, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.getRandomValues || byteLength < 16 || byteLength > 96) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  const bytes = new Uint8Array(byteLength);
  cryptoImpl.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  const digest = await cryptoImpl.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createPkcePair(cryptoImpl = globalThis.crypto) {
  const verifier = randomBase64Url(64, cryptoImpl);
  const digest = await cryptoImpl.subtle.digest("SHA-256", encoder.encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function isValidPkceVerifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

export function isValidOAuthState(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function validateConsumedOAuthState(value) {
  const row = assertObject(value, "oauth_state_expired");
  const keys = Object.keys(row).sort();
  const expected = ["code_verifier", "company_key", "redirect_uri", "state_id"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new FlowAccountSafeError("oauth_state_expired", 400);
  }
  if (
    typeof row.state_id !== "string" ||
    typeof row.company_key !== "string" ||
    !isValidPkceVerifier(row.code_verifier) ||
    typeof row.redirect_uri !== "string"
  ) {
    throw new FlowAccountSafeError("oauth_state_expired", 400);
  }
  return row;
}

export function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left ?? ""));
  const b = encoder.encode(String(right ?? ""));
  const length = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index % Math.max(a.length, 1)] ?? 0) ^
      (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return diff === 0;
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) {
    return Math.min(Number(retryAfter) * 1_000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(250 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

export async function fetchWithRetry(
  fetchImpl,
  url,
  init = {},
  options = {},
) {
  const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts ?? MAX_PROVIDER_ATTEMPTS), 5));
  const timeoutMs = Math.max(250, Math.min(Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60_000));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      clearTimeout(timeout);
      if (attempt + 1 < maxAttempts) {
        await sleep(Math.min(250 * 2 ** attempt, MAX_RETRY_DELAY_MS));
        continue;
      }
      const timedOut = error?.name === "AbortError" || controller.signal.aborted;
      throw new FlowAccountSafeError(timedOut ? "provider_timeout" : "provider_unavailable", 503);
    }
    clearTimeout(timeout);

    if (response.status !== 429 && response.status < 500) return response;
    if (attempt + 1 >= maxAttempts) {
      throw new FlowAccountSafeError(
        response.status === 429 ? "provider_rate_limited" : "provider_unavailable",
        response.status === 429 ? 429 : 503,
      );
    }
    try {
      await response.body?.cancel();
    } catch {
      // Never inspect a provider error body; cancellation only releases the stream.
    }
    await sleep(retryDelay(response, attempt));
  }
  throw new FlowAccountSafeError("provider_unavailable", 503);
}

async function fetchJsonObject(fetchImpl, url, init, failureCode) {
  const response = await fetchWithRetry(fetchImpl, url, init);
  if (!response.ok) throw new FlowAccountSafeError(failureCode, 502);
  try {
    return assertObject(await response.json(), failureCode);
  } catch (error) {
    if (error instanceof FlowAccountSafeError) throw error;
    throw new FlowAccountSafeError(failureCode, 502);
  }
}

function requireFlowAccountUrl(value, code = "oauth_configuration_invalid") {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new FlowAccountSafeError(code, 502);
  }
  if (url.protocol !== "https:" || url.origin !== FLOWACCOUNT_ORIGIN) {
    throw new FlowAccountSafeError(code, 502);
  }
  return url.toString();
}

export async function discoverFlowAccountOAuth(fetchImpl = fetch) {
  const resourceMetadata = await fetchJsonObject(
    fetchImpl,
    `${FLOWACCOUNT_ORIGIN}/.well-known/oauth-protected-resource`,
    { headers: { Accept: "application/json" } },
    "oauth_metadata_unavailable",
  );
  if (resourceMetadata.resource !== FLOWACCOUNT_ORIGIN) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  const issuer = requireFlowAccountUrl(resourceMetadata.authorization_servers?.[0]);
  const metadataUrl = new URL("/.well-known/oauth-authorization-server", issuer).toString();
  const metadata = await fetchJsonObject(
    fetchImpl,
    metadataUrl,
    { headers: { Accept: "application/json" } },
    "oauth_metadata_unavailable",
  );

  if (requireFlowAccountUrl(metadata.issuer) !== FLOWACCOUNT_ORIGIN + "/") {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  const authorizationEndpoint = requireFlowAccountUrl(metadata.authorization_endpoint);
  const tokenEndpoint = requireFlowAccountUrl(metadata.token_endpoint);
  const registrationEndpoint = requireFlowAccountUrl(metadata.registration_endpoint);
  if (!metadata.response_types_supported?.includes("code")) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  if (!metadata.grant_types_supported?.includes("authorization_code") ||
      !metadata.grant_types_supported?.includes("refresh_token")) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  if (!metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  if (!metadata.token_endpoint_auth_methods_supported?.includes("none")) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  if (!FLOWACCOUNT_SCOPES.every((scope) => metadata.scopes_supported?.includes(scope))) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 502);
  }
  return {
    issuer: FLOWACCOUNT_ORIGIN,
    resource: FLOWACCOUNT_ORIGIN,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
  };
}

function assertTrustedRedirectUri(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  url.hash = "";
  return url.toString();
}

export async function registerOAuthClient(fetchImpl, metadata, redirectUri) {
  const trustedRedirect = assertTrustedRedirectUri(redirectUri);
  const registration = await fetchJsonObject(
    fetchImpl,
    metadata.registrationEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "CoreBiz Center FlowAccount Price Sync",
        redirect_uris: [trustedRedirect],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: FLOWACCOUNT_SCOPES.join(" "),
      }),
    },
    "oauth_client_registration_failed",
  );
  const clientId = typeof registration.client_id === "string" ? registration.client_id.trim() : "";
  const clientSecret = typeof registration.client_secret === "string"
    ? registration.client_secret.trim()
    : "";
  if (!clientId || clientId.length > 1_024 || clientSecret.length > 4_096) {
    throw new FlowAccountSafeError("oauth_client_registration_failed", 502);
  }
  return { clientId, clientSecret: clientSecret || null };
}

export function buildAuthorizationUrl(metadata, values) {
  if (!isValidOAuthState(values.state) || !/^[A-Za-z0-9_-]{43}$/.test(values.codeChallenge)) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  const clientId = String(values.clientId ?? "").trim();
  if (!clientId) throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", assertTrustedRedirectUri(values.redirectUri));
  url.searchParams.set("scope", FLOWACCOUNT_SCOPES.join(" "));
  url.searchParams.set("state", values.state);
  url.searchParams.set("code_challenge", values.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", metadata.resource);
  return url.toString();
}

async function requestOAuthToken(fetchImpl, metadata, form, failureCode) {
  const response = await fetchWithRetry(fetchImpl, metadata.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) throw new FlowAccountSafeError(failureCode, 502);
  let token;
  try {
    token = assertObject(await response.json(), failureCode);
  } catch (error) {
    if (error instanceof FlowAccountSafeError) throw error;
    throw new FlowAccountSafeError(failureCode, 502);
  }
  const accessToken = typeof token.access_token === "string" ? token.access_token.trim() : "";
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token.trim() : "";
  if (!accessToken || accessToken.length > 16_384 || refreshToken.length > 16_384) {
    throw new FlowAccountSafeError(failureCode, 502);
  }
  const expiresIn = Number(token.expires_in);
  return {
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: new Date(Date.now() + (
      Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 86_400) : 300
    ) * 1_000).toISOString(),
    scopes: typeof token.scope === "string"
      ? token.scope.split(/\s+/).filter((scope) => FLOWACCOUNT_SCOPES.includes(scope))
      : [...FLOWACCOUNT_SCOPES],
  };
}

export function exchangeAuthorizationCode(fetchImpl, metadata, values) {
  if (!isValidPkceVerifier(values.codeVerifier)) {
    throw new FlowAccountSafeError("oauth_token_exchange_failed", 400);
  }
  return requestOAuthToken(fetchImpl, metadata, {
    grant_type: "authorization_code",
    code: String(values.code ?? ""),
    client_id: String(values.clientId ?? ""),
    redirect_uri: assertTrustedRedirectUri(values.redirectUri),
    code_verifier: values.codeVerifier,
    resource: metadata.resource,
  }, "oauth_token_exchange_failed");
}

export function refreshOAuthToken(fetchImpl, metadata, values) {
  const refreshToken = String(values.refreshToken ?? "").trim();
  if (!refreshToken) throw new FlowAccountSafeError("connection_required", 409);
  return requestOAuthToken(fetchImpl, metadata, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: String(values.clientId ?? ""),
    scope: FLOWACCOUNT_SCOPES.join(" "),
    resource: metadata.resource,
  }, "oauth_token_exchange_failed");
}

export function parseSseJson(text) {
  const messages = [];
  let dataLines = [];
  const flush = () => {
    if (!dataLines.length) return;
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) messages.push(...parsed);
      else messages.push(parsed);
    } catch {
      throw new FlowAccountSafeError("mcp_protocol_error", 502);
    }
  };
  for (const rawLine of String(text ?? "").replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine) {
      flush();
    } else if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice(5).replace(/^ /, ""));
    }
  }
  flush();
  return messages;
}

export function parseMcpWireText(text, contentType = "") {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  if (/text\/event-stream/i.test(contentType) || /^(?:event:|data:)/m.test(raw)) {
    return parseSseJson(raw);
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new FlowAccountSafeError("mcp_protocol_error", 502);
  }
}

export class McpStreamableClient {
  constructor({ fetchImpl = fetch, endpoint = FLOWACCOUNT_MCP_ENDPOINT, accessToken }) {
    if (endpoint !== FLOWACCOUNT_MCP_ENDPOINT || !String(accessToken ?? "").trim()) {
      throw new FlowAccountSafeError("mcp_initialize_failed", 500);
    }
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.accessToken = accessToken;
    this.sessionId = null;
    this.protocolVersion = MCP_PROTOCOL_VERSION;
    this.nextId = 1;
    this.initialized = false;
  }

  async request(method, params = {}, { notification = false } = {}) {
    const id = notification ? undefined : this.nextId++;
    const request = { jsonrpc: "2.0", method, params };
    if (!notification) request.id = id;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    const response = await fetchWithRetry(this.fetchImpl, this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new FlowAccountSafeError("mcp_protocol_error", 502);
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (notification && [202, 204].includes(response.status)) return null;
    const wireText = await response.text();
    if (wireText.length > 8_000_000) {
      throw new FlowAccountSafeError("mcp_protocol_error", 502);
    }
    const messages = parseMcpWireText(
      wireText,
      response.headers.get("content-type") ?? "",
    );
    if (notification && messages.length === 0) return null;
    // An SSE stream can contain notifications or replies for other requests.
    // Only the response bound to this request may satisfy it.
    const message = messages.find((candidate) => candidate?.id === id);
    if (!message || message.jsonrpc !== "2.0" || message.error) {
      throw new FlowAccountSafeError("mcp_protocol_error", 502);
    }
    return message.result;
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "corebiz-flowaccount-price-sync", version: "1.0.0" },
    });
    if (!result || typeof result !== "object" ||
        !SUPPORTED_MCP_PROTOCOL_VERSIONS.has(result.protocolVersion)) {
      throw new FlowAccountSafeError("mcp_initialize_failed", 502);
    }
    this.protocolVersion = result.protocolVersion;
    await this.request("notifications/initialized", {}, { notification: true });
    this.initialized = true;
    return result;
  }

  async listTools() {
    if (!this.initialized) throw new FlowAccountSafeError("mcp_initialize_failed", 500);
    const tools = [];
    const names = new Set();
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < 25; page += 1) {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      if (!result || !Array.isArray(result.tools)) {
        throw new FlowAccountSafeError("mcp_protocol_error", 502);
      }
      for (const tool of result.tools) {
        if (!tool || typeof tool.name !== "string" || names.has(tool.name)) continue;
        names.add(tool.name);
        tools.push(tool);
      }
      if (!result.nextCursor) return tools;
      cursor = String(result.nextCursor);
      if (!cursor || cursors.has(cursor)) {
        throw new FlowAccountSafeError("mcp_pagination_invalid", 502);
      }
      cursors.add(cursor);
    }
    throw new FlowAccountSafeError("mcp_pagination_incomplete", 502);
  }

  async callTool(toolName, args) {
    if (!this.initialized) throw new FlowAccountSafeError("mcp_initialize_failed", 500);
    if (!isAllowedReadToolName(toolName)) {
      throw new FlowAccountSafeError("mcp_tool_failed", 500);
    }
    const result = await this.request("tools/call", { name: toolName, arguments: args });
    if (!result || typeof result !== "object" || result.isError === true) {
      throw new FlowAccountSafeError("mcp_tool_failed", 502);
    }
    return result;
  }
}

const WRITE_VERB = /(?:^|[_./:-])(create|update|delete|remove|write|mutate|post|put|patch|add|edit|void|cancel|send|issue|approve|convert|upload|set|mark)(?:$|[_./:-])/i;
const READ_VERB = /(?:^|[_./:-])(list|search|query|find|fetch|read)(?:$|[_./:-])/i;

function normalizedToolName(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/^mcp__codex_apps__flowaccount_/, "")
    .replace(/^flowaccount[_./:-]+/, "");
}

function inferResourceKind(name) {
  const normalized = normalizedToolName(name);
  if (WRITE_VERB.test(normalized)) return null;
  if (normalized === "sales__get_document") return "sales_document";
  if (!READ_VERB.test(normalized)) return null;
  if (/^company(?:__|[./:-])list$/.test(normalized)) return "company";
  if (/cash[_-]?invoices?/.test(normalized)) return "cash_invoices";
  if (/tax[_-]?invoices?/.test(normalized)) return "tax_invoices";
  if (/quotations?|quotes?/.test(normalized)) return "quotations";
  return null;
}

export function isAllowedReadToolName(name) {
  return inferResourceKind(name) !== null;
}

function toolScore(tool, kind) {
  const name = normalizedToolName(tool.name);
  const exact = {
    company: "company__list",
    quotations: "sales__list_quotations",
    tax_invoices: "sales__list_tax_invoices",
    cash_invoices: "sales__list_cash_invoices",
    sales_document: "sales__get_document",
  }[kind];
  let score = name === exact ? 100 : 0;
  if (/(?:^|[_./:-])list(?:$|[_./:-])/.test(name)) score += 20;
  const properties = tool.inputSchema?.properties;
  if (properties?.cursor) score += 4;
  if (properties?.fields) score += 4;
  if ((kind === "quotations" || kind === "tax_invoices") && properties?.period) score += 4;
  return score;
}

function selectOneTool(tools, kind) {
  const candidates = tools
    .filter((tool) => tool && inferResourceKind(tool.name) === kind)
    .map((tool) => ({ tool, score: toolScore(tool, kind) }))
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
  if (!candidates.length) throw new FlowAccountSafeError("mcp_read_tools_missing", 502);
  if (candidates[1] && candidates[1].score === candidates[0].score) {
    throw new FlowAccountSafeError("mcp_tool_ambiguous", 502);
  }
  return candidates[0].tool;
}

export function discoverPriceReadTools(tools) {
  if (!Array.isArray(tools)) throw new FlowAccountSafeError("mcp_read_tools_missing", 502);
  const selected = {};
  for (const kind of ["quotations", "tax_invoices", "cash_invoices"]) {
    selected[kind] = selectOneTool(tools, kind);
  }
  return selected;
}

export function discoverCurrentCompanyTool(tools) {
  if (!Array.isArray(tools)) throw new FlowAccountSafeError("mcp_read_tools_missing", 502);
  const tool = selectOneTool(tools, "company");
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  if (required.length > 0) throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  return tool;
}

export function discoverSalesDocumentDetailTool(tools) {
  if (!Array.isArray(tools)) throw new FlowAccountSafeError("mcp_read_tools_missing", 502);
  const tool = selectOneTool(tools, "sales_document");
  const properties = tool.inputSchema?.properties ?? {};
  for (const key of ["document_type", "record_id", "fields"]) {
    if (!properties[key]) throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  }
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  if (required.some((key) => !["document_type", "record_id"].includes(key))) {
    throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  }
  return tool;
}

const EXPLICIT_FIELDS = Object.freeze({
  quotations: [
    "recordId", "documentSerial", "documentDate", "modifiedOn", "contactId", "contactTaxId",
    "status",
  ],
  tax_invoices: [
    "recordId", "documentSerial", "documentDate", "modifiedOn", "contactId", "contactTaxId",
    "status",
  ],
  cash_invoices: [
    "recordId", "documentSerial", "documentDate", "modifiedOn", "contactId", "contactTaxId",
    "status",
  ],
});

const DETAIL_FIELDS = Object.freeze([
  "recordId", "documentSerial", "publishedOn", "modifiedOn", "contactId", "contactTaxId",
  "status", "statusString", "foreignCurrency", "isForeignBase", "isForeignCurrency",
  "exchangeRate", "exchangeRatio", "isManualVat", "isVatInclusive", "isVat", "vatRate",
  "discount", "discountPercentage", "deductionAmount", "documentDeductionType",
  "inlineDiscountValue", "foreignDiscount", "foreignDeductionAmount", "useInlineDiscount",
  "subTotal", "total", "totalAfterDiscount", "totalWithoutVat", "productItems",
]);

export function buildReadToolArguments(tool, kind, window = {}) {
  const properties = tool?.inputSchema?.properties ?? {};
  if (!EXPLICIT_FIELDS[kind] || !properties.fields || !properties.cursor || !properties.period) {
    throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  }
  const args = { fields: [...EXPLICIT_FIELDS[kind]] };
  args.period = `${window.start}_${window.end}`;
  if (properties.page) args.page = 1;
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  for (const key of required) {
    if (!(key in args) || key === "token") {
      throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
    }
  }
  return args;
}

export function buildSalesDocumentDetailArguments(tool, kind, recordId) {
  const properties = tool?.inputSchema?.properties ?? {};
  if (!properties.document_type || !properties.record_id || !properties.fields) {
    throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  }
  const documentType = kind === "quotations"
    ? "quotation"
    : kind === "tax_invoices"
    ? "tax_invoice"
    : kind === "cash_invoices" ? "cash_invoice" : null;
  const safeRecordId = safePositiveId(recordId);
  if (!documentType || !safeRecordId) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const args = {
    document_type: documentType,
    record_id: safeRecordId,
    fields: [...DETAIL_FIELDS],
  };
  const required = Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required : [];
  if (required.some((key) => !(key in args))) {
    throw new FlowAccountSafeError("mcp_tool_schema_unsupported", 502);
  }
  return args;
}

export function extractMcpToolPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const textBlocks = Array.isArray(result?.content)
    ? result.content.filter((item) => item?.type === "text" && typeof item.text === "string")
    : [];
  for (const block of textBlocks) {
    try {
      const parsed = JSON.parse(block.text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // A human-readable provider message is never treated as structured data.
    }
  }
  throw new FlowAccountSafeError("mcp_tool_failed", 502);
}

export async function discoverCurrentCompany(client, tools) {
  const companyTool = discoverCurrentCompanyTool(tools);
  const payload = extractMcpToolPayload(await client.callTool(companyTool.name, {}));
  const companies = Array.isArray(payload?.companies)
    ? payload.companies
    : Array.isArray(payload?.data?.companies) ? payload.data.companies : null;
  if (!companies) throw new FlowAccountSafeError("mcp_tool_failed", 502);
  const current = companies.filter((company) => company?.is_current === true);
  if (current.length !== 1) throw new FlowAccountSafeError("mcp_tool_ambiguous", 502);
  const providerCompanyId = String(current[0].support_code ?? "").trim();
  const providerCompanyName = String(current[0].name ?? "").trim();
  if (
    !providerCompanyId || providerCompanyId.length > 200 || /[\u0000-\u001f\u007f]/.test(providerCompanyId) ||
    !providerCompanyName || providerCompanyName.length > 300 || /[\u0000-\u001f\u007f]/.test(providerCompanyName)
  ) {
    throw new FlowAccountSafeError("mcp_tool_failed", 502);
  }
  const declaredCurrent = typeof payload.current_company === "string"
    ? payload.current_company.trim()
    : null;
  if (declaredCurrent && declaredCurrent !== providerCompanyName) {
    throw new FlowAccountSafeError("mcp_tool_ambiguous", 502);
  }
  return { providerCompanyId, providerCompanyName };
}

export function assertExpectedCompany(currentCompany, expected = {}) {
  const expectedId = String(expected.id ?? "").trim();
  const expectedName = String(expected.name ?? "").trim();
  if (!expectedId && !expectedName) {
    throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  }
  const matchesExpectedTenant = expectedId
    ? currentCompany?.providerCompanyId === expectedId
    : currentCompany?.providerCompanyName === expectedName;
  if (!matchesExpectedTenant) {
    throw new FlowAccountSafeError("flowaccount_company_mismatch", 409);
  }
  return currentCompany;
}

function detailDocumentFromPayload(payload, expectedRecordId) {
  const wrapped = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data);
  if (wrapped && ((payload.status !== undefined && payload.status !== true) ||
      (payload.code !== undefined && Number(payload.code) !== 0))) {
    throw new FlowAccountSafeError("mcp_tool_failed", 502);
  }
  const document = wrapped
    ? payload.data
    : payload?.document && typeof payload.document === "object" && !Array.isArray(payload.document)
    ? payload.document
    : payload;
  if (!document || typeof document !== "object" || Array.isArray(document) ||
      safePositiveId(document.recordId) !== expectedRecordId ||
      !isoDate(document.publishedOn) ||
      !safePositiveId(document.contactId) ||
      !Number.isInteger(document.status) ||
      typeof document.isForeignCurrency !== "boolean" ||
      (document.isForeignBase !== undefined && document.isForeignBase !== null &&
        typeof document.isForeignBase !== "boolean") ||
      typeof document.foreignCurrency !== "number" || !Number.isFinite(document.foreignCurrency) ||
      typeof document.isManualVat !== "boolean" ||
      typeof document.isVatInclusive !== "boolean" ||
      typeof document.isVat !== "boolean" ||
      typeof document.vatRate !== "number" || !Number.isFinite(document.vatRate) ||
      typeof document.discount !== "number" || !Number.isFinite(document.discount) ||
      typeof document.discountPercentage !== "number" || !Number.isFinite(document.discountPercentage) ||
      typeof document.deductionAmount !== "number" || !Number.isFinite(document.deductionAmount) ||
      !Array.isArray(document.productItems)) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const foreignMarker = document.foreignCurrency;
  const markerIsFalsy = foreignMarker === undefined || foreignMarker === null || foreignMarker === false ||
    foreignMarker === 0 || foreignMarker === "" || foreignMarker === "0";
  if (!document.isForeignCurrency && document.isForeignBase !== true && !markerIsFalsy) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  for (const line of document.productItems) {
    if (!line || typeof line !== "object" || Array.isArray(line) ||
        typeof line.quantity !== "number" || !Number.isFinite(line.quantity) ||
        typeof line.pricePerUnit !== "number" || !Number.isFinite(line.pricePerUnit) ||
        typeof line.total !== "number" || !Number.isFinite(line.total) ||
        typeof line.discountPerItem !== "number" || !Number.isFinite(line.discountPerItem) ||
        typeof line.discountPerItemValue !== "number" || !Number.isFinite(line.discountPerItemValue) ||
        typeof line.isVat !== "boolean" ||
        typeof line.vatRate !== "number" || !Number.isFinite(line.vatRate)) {
      throw new FlowAccountSafeError("sync_source_incomplete", 502);
    }
  }
  return document;
}

export async function hydrateSalesDocumentDetails(client, tool, documents, kind, targetTaxIds = null) {
  if (!Array.isArray(documents) || documents.length > MAX_DETAIL_DOCUMENTS) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const ids = documents.map((document) => safePositiveId(document?.recordId));
  if (ids.some((recordId) => !recordId) || new Set(ids).size !== ids.length) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const targets = targetTaxIds === null ? null : new Set(normalizeTargetTaxIds(targetTaxIds));
  const hydrated = [];
  for (let offset = 0; offset < documents.length; offset += DETAIL_CONCURRENCY) {
    const batch = documents.slice(offset, offset + DETAIL_CONCURRENCY);
    const details = await Promise.all(batch.map(async (summary) => {
      const recordId = safePositiveId(summary.recordId);
      const args = buildSalesDocumentDetailArguments(tool, kind, recordId);
      const payload = extractMcpToolPayload(await client.callTool(tool.name, args));
      const detail = detailDocumentFromPayload(payload, recordId);
      const summaryStatus = normalizedDocumentStatus(kind, summary.status);
      const detailStatus = Number(detail.status);
      if (!Number.isInteger(summaryStatus) || !Number.isInteger(detailStatus) || summaryStatus !== detailStatus) {
        throw new FlowAccountSafeError("sync_source_incomplete", 502);
      }
      const summaryTaxId = normalizeThaiTaxId(summary.contactTaxId);
      const detailTaxId = normalizeThaiTaxId(detail.contactTaxId);
      const summaryContactId = safePositiveId(summary.contactId);
      const detailContactId = safePositiveId(detail.contactId);
      const provenTaxId = detailTaxId || summaryTaxId;
      if ((summaryTaxId && detailTaxId && summaryTaxId !== detailTaxId) ||
          (summaryContactId && summaryContactId !== detailContactId) ||
          (targets && (!provenTaxId || !targets.has(provenTaxId)))) {
        throw new FlowAccountSafeError("sync_source_incomplete", 502);
      }
      return detailTaxId || !provenTaxId ? detail : { ...detail, contactTaxId: provenTaxId };
    }));
    hydrated.push(...details);
  }
  return hydrated;
}

function collectionFromPayload(payload) {
  const candidates = [
    payload?.data?.list,
    payload?.data?.items,
    payload?.list,
    payload?.items,
    payload?.results,
    Array.isArray(payload?.data) ? payload.data : null,
  ];
  return candidates.find(Array.isArray) ?? null;
}

function paginationFromPayload(payload) {
  return payload?.pagination ?? payload?.data?.pagination ?? null;
}

export async function paginateReadTool(client, tool, baseArguments, options = {}) {
  const maxPages = Math.min(Number(options.maxPages ?? MAX_TOOL_PAGES), MAX_TOOL_PAGES);
  const maxRecords = Math.min(Number(options.maxRecords ?? MAX_TOOL_RECORDS), MAX_TOOL_RECORDS);
  const rows = [];
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const args = { ...baseArguments };
    if (cursor) {
      args.cursor = cursor;
      delete args.page;
    }
    const payload = extractMcpToolPayload(await client.callTool(tool.name, args));
    const list = collectionFromPayload(payload);
    if (!list) throw new FlowAccountSafeError("sync_source_incomplete", 502);
    rows.push(...list);
    if (rows.length > maxRecords) {
      throw new FlowAccountSafeError("sync_source_incomplete", 502);
    }
    const pagination = paginationFromPayload(payload);
    const hasMore = pagination?.hasMore;
    const nextCursor = pagination?.nextCursor;
    if (hasMore === false) return rows;
    if (hasMore === true || nextCursor) {
      if (typeof nextCursor !== "string" || !nextCursor || cursors.has(nextCursor)) {
        throw new FlowAccountSafeError("mcp_pagination_invalid", 502);
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
      continue;
    }
    const total = Number(payload?.data?.count ?? payload?.count);
    if (Number.isFinite(total) && total > rows.length) {
      throw new FlowAccountSafeError("mcp_pagination_incomplete", 502);
    }
    return rows;
  }
  throw new FlowAccountSafeError("mcp_pagination_incomplete", 502);
}

function pick(record, names) {
  for (const name of names) {
    if (record?.[name] !== undefined && record?.[name] !== null) return record[name];
  }
  return undefined;
}

function safePositiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function normalizeThaiTaxId(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  return digits.length === 13 ? digits : null;
}

export function normalizeSku(value) {
  const sku = String(value ?? "").normalize("NFKC").trim().toUpperCase();
  return sku && sku.length <= 160 && !/[\u0000-\u001f\u007f]/.test(sku) ? sku : null;
}

export function normalizeUnit(value) {
  const unit = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return unit && unit.length <= 80 && !/[\u0000-\u001f\u007f]/.test(unit) ? unit : null;
}

function unitKey(value) {
  return normalizeUnit(value)?.toLocaleLowerCase("en-US") ?? null;
}

function exactQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) return null;
  const rounded = Math.round(quantity * 1_000) / 1_000;
  return Math.abs(quantity - rounded) <= 1e-9 ? rounded : null;
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99_999_999_999) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function hasNonZero(record, keys) {
  for (const key of keys) {
    if (record?.[key] === undefined || record?.[key] === null || record?.[key] === "") continue;
    const numeric = Number(record[key]);
    if (!Number.isFinite(numeric) || Math.abs(numeric) > 0.000001) return true;
  }
  return false;
}

function documentCurrency(document) {
  if (typeof document?.isForeignCurrency !== "boolean" ||
      (document.isForeignBase !== undefined && document.isForeignBase !== null &&
        typeof document.isForeignBase !== "boolean")) return null;
  if (document.isForeignCurrency || document.isForeignBase === true) return null;
  const marker = document.foreignCurrency;
  const markerIsFalsy = marker === undefined || marker === null || marker === false ||
    marker === 0 || marker === "" || marker === "0";
  return markerIsFalsy ? "THB" : null;
}

const ELIGIBLE_STATUS_CODES = Object.freeze({
  quotations: new Set([3, 5, 11, 13, 15, 17, 41, 43, 45]),
  tax_invoices: new Set([3, 5, 11]),
  cash_invoices: new Set([3, 5]),
});

const STATUS_CODE_BY_LABEL = Object.freeze({
  quotations: Object.freeze({
    awaiting: 1,
    approved: 3,
    approvedandprocessed: 5,
    void: 7,
    rejected: 9,
    billingnotepartials: 11,
    invoicepartials: 13,
    billingnotepartialsprocessed: 15,
    invoicepartialsprocessed: 17,
    cashinvoicepartials: 41,
    cashinvoicepartialsprocessed: 43,
    deposited: 45,
  }),
  tax_invoices: Object.freeze({
    awaiting: 1,
    invoicedelivered: 3,
    paid: 5,
    void: 7,
    invoicereceived: 9,
    receiptpartials: 11,
  }),
  cash_invoices: Object.freeze({
    awaiting: 1,
    invoicedelivered: 3,
    paid: 5,
    void: 7,
    invoicereceived: 9,
  }),
});

function normalizedDocumentStatus(kind, value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (/^[0-9]{1,4}$/.test(raw)) return Number(raw);
  const label = raw.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
  return STATUS_CODE_BY_LABEL[kind]?.[label] ?? null;
}

export function normalizeTargetTaxIds(values) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new FlowAccountSafeError("active_customer_limit_exceeded", 409);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    const taxId = normalizeThaiTaxId(raw);
    if (!taxId || taxId !== raw || seen.has(taxId)) {
      throw new FlowAccountSafeError("sync_source_incomplete", 502);
    }
    seen.add(taxId);
    normalized.push(taxId);
  }
  return normalized;
}

export function prefilterEligibleDocumentSummaries(
  documents,
  kind,
  targetTaxIds,
  targetContactIds = [],
) {
  const allowed = ELIGIBLE_STATUS_CODES[kind];
  if (!allowed || !Array.isArray(documents)) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const targets = new Set(normalizeTargetTaxIds(targetTaxIds));
  const contacts = new Set(targetContactIds.map(safePositiveId).filter(Boolean));
  const candidates = [];
  const unresolved = [];
  let omittedRows = 0;
  for (const document of documents) {
    const recordId = safePositiveId(document?.recordId);
    const status = normalizedDocumentStatus(kind, document?.status);
    const taxId = normalizeThaiTaxId(document?.contactTaxId);
    const contactId = safePositiveId(document?.contactId);
    const publishedOn = isoDate(document?.publishedOn ?? document?.documentDate);
    if (!recordId) {
      throw new FlowAccountSafeError("sync_source_incomplete", 502);
    }
    const eligibleStatus = status !== null && allowed.has(status);
    const exactTaxMatch = taxId && targets.has(taxId);
    // The list projection may omit/blank documentDate. Exact target identity
    // and status are enough to hydrate; the required detail publishedOn is the
    // authoritative date and normalization applies the 180-day window again.
    if (eligibleStatus && exactTaxMatch) {
      candidates.push(document);
      continue;
    }
    // A provider contact ID is useful only to bound a later probe. It is not a
    // substitute for the verified tax ID, because documents may omit or carry
    // stale contact metadata. Only cash invoices get the bounded probe below;
    // the hydrated document still needs an exact target tax ID before import.
    if (eligibleStatus && !taxId && contactId && contacts.has(contactId)) {
      unresolved.push(document);
      continue;
    }
    const lines = document?.productItems;
    omittedRows += Array.isArray(lines) && lines.length > 0 ? lines.length : 1;
  }
  return { candidates, unresolved, omittedRows };
}

export function verifiedTargetTaxByContactId(documents, targetTaxIds) {
  if (!Array.isArray(documents)) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const targets = new Set(normalizeTargetTaxIds(targetTaxIds));
  const taxIdsByContact = new Map();
  for (const document of documents) {
    const contactId = safePositiveId(document?.contactId);
    const taxId = normalizeThaiTaxId(document?.contactTaxId);
    if (!contactId || !taxId) continue;
    const taxIds = taxIdsByContact.get(contactId) ?? new Set();
    taxIds.add(taxId);
    taxIdsByContact.set(contactId, taxIds);
  }
  const verified = new Map();
  for (const [contactId, taxIds] of taxIdsByContact) {
    if (taxIds.size !== 1) continue;
    const [taxId] = taxIds;
    if (targets.has(taxId)) verified.set(contactId, taxId);
  }
  return verified;
}

async function hydrateInferredTaxDetails(
  client,
  tool,
  documents,
  kind,
  targetTaxIds,
  targetTaxByContactId,
) {
  if (!Array.isArray(documents) || !(targetTaxByContactId instanceof Map)) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const targets = new Set(normalizeTargetTaxIds(targetTaxIds));
  // Keep the provider summaries untouched while validating detail status and
  // contact ID. The inferred tax identity is attached only after those checks.
  const details = await hydrateSalesDocumentDetails(client, tool, documents, kind);
  return details.map((detail, index) => {
    const summaryContactId = safePositiveId(documents[index]?.contactId);
    const detailContactId = safePositiveId(detail?.contactId);
    const mappedTaxId = targetTaxByContactId.get(summaryContactId);
    const detailTaxId = normalizeThaiTaxId(detail?.contactTaxId);
    if (!summaryContactId || detailContactId !== summaryContactId ||
        !mappedTaxId || !targets.has(mappedTaxId) ||
        (detailTaxId && detailTaxId !== mappedTaxId)) {
      throw new FlowAccountSafeError("sync_source_incomplete", 502);
    }
    return detailTaxId ? detail : { ...detail, contactTaxId: mappedTaxId };
  });
}

function statusEligibility(kind, status, statusText) {
  const label = String(statusText ?? "").toLocaleLowerCase();
  if (/void|cancel|reject|ยกเลิก|ปฏิเสธ/.test(label)) return "status_not_eligible";
  const allowed = ELIGIBLE_STATUS_CODES[kind] ?? new Set();
  return allowed.has(status) ? null : "status_not_eligible";
}

function priceBeforeVat(document, line, quantity) {
  if (hasNonZero(document, [
    "discount", "discountPercentage", "discountAmount", "documentDiscountAmount",
    "deductionAmount", "documentDeductionAmount", "inlineDiscountValue", "foreignDiscount",
    "foreignDeductionAmount",
  ])) {
    return { price: null, reason: "discounted_line" };
  }

  const explicitNet = money(pick(line, ["netUnitPrice", "priceBeforeVat", "unitPriceBeforeVat"]));
  if (explicitNet) return { price: explicitNet, reason: null };

  if (hasNonZero(line, [
    "discount", "discountPercentage", "discountAmount", "discountValue", "discountPercent",
    "discountPerItem", "discountPerItemValue", "foreignDiscountPerItem",
    "foreignDiscountPerItemValue", "documentInlineDiscount",
  ])) {
    return { price: null, reason: "discounted_line" };
  }

  const unitPrice = money(pick(line, ["pricePerUnit", "unitPrice", "price"]));
  const total = money(pick(line, ["total", "lineTotal", "totalBeforeVat"]));
  if (!unitPrice && !total) return { price: null, reason: "price_invalid" };
  if (unitPrice && total && Math.abs(total - unitPrice * quantity) > 0.02) {
    return { price: null, reason: "price_ambiguous" };
  }
  let price = unitPrice ?? money(total / quantity);
  if (!price) return { price: null, reason: "price_invalid" };

  const isVatInclusive = pick(line, ["isVatInclusive", "priceIncludesVat"])
    ?? pick(document, ["isVatInclusive", "priceIncludesVat"]);
  const isVat = pick(line, ["isVat"] ) ?? pick(document, ["isVat"]);
  const manualVat = pick(document, ["isManualVat"]);
  const rawVatRate = pick(line, ["vatRate"] ) ?? pick(document, ["vatRate"]);
  const vatRate = rawVatRate === undefined || rawVatRate === null || rawVatRate === ""
    ? null
    : Number(rawVatRate);

  if (isVatInclusive === false) return { price, reason: null };
  if (isVat === false || (Number.isFinite(vatRate) && vatRate <= 0)) {
    return { price, reason: null };
  }
  if (isVatInclusive === true && isVat === true && manualVat === false) {
    const rate = Number.isFinite(vatRate) && vatRate > 0 ? vatRate : 7;
    price = money(price / (1 + rate / 100));
    return price ? { price, reason: null } : { price: null, reason: "price_invalid" };
  }
  return { price: null, reason: "vat_ambiguous" };
}

function lineProduct(line) {
  const lineSku = normalizeSku(pick(line, ["sku", "productCode", "code"]));
  const lineUnit = normalizeUnit(pick(line, ["unitName", "unit"]));
  return lineSku && lineUnit ? { sku: lineSku, unit: lineUnit } : null;
}

function isoDate(value) {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))
    ? raw
    : null;
}

function isoTimestamp(value, fallbackDate) {
  const date = new Date(value ?? `${fallbackDate}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? `${fallbackDate}T00:00:00.000Z` : date.toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function rollingDateWindow(now = new Date(), days = 180) {
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDate = new Date(endDate.getTime() - days * 86_400_000);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

/**
 * @param {{
 *   quotations?: Array<Record<string, any>>,
 *   taxInvoices?: Array<Record<string, any>>,
 *   cashInvoices?: Array<Record<string, any>>,
 *   targetTaxIds: string[],
 *   window: {start: string, end: string}
 * }} source
 */
export async function normalizePriceGeneration({
  quotations = [],
  taxInvoices = [],
  cashInvoices = [],
  prefilteredOmittedRows = 0,
  targetTaxIds = [],
  window,
}) {
  const targets = new Set(normalizeTargetTaxIds(targetTaxIds));
  const rows = [];
  const rowKeys = new Set();
  let omittedRows = Number.isSafeInteger(prefilteredOmittedRows) && prefilteredOmittedRows >= 0
    ? prefilteredOmittedRows
    : 0;
  const documents = [
    ...quotations.map((document) => ({ kind: "quotations", document })),
    ...taxInvoices.map((document) => ({ kind: "tax_invoices", document })),
    ...cashInvoices.map((document) => ({ kind: "cash_invoices", document })),
  ];

  for (const { kind, document } of documents) {
    const recordId = safePositiveId(pick(document, ["recordId", "documentId", "id"]));
    const publishedOn = isoDate(pick(document, ["publishedOn", "documentDate"]));
    const status = Number(pick(document, ["status", "statusId"]));
    const contactId = safePositiveId(pick(document, ["contactId", "contact_id"]));
    const taxId = normalizeThaiTaxId(pick(document, ["contactTaxId", "taxId"]));
    const currency = documentCurrency(document);
    const lines = pick(document, ["productItems", "productItemsNested", "items", "lines"]);
    const structurallyComplete = recordId && publishedOn && Number.isInteger(status) &&
      status >= 0 && status <= 10_000 && contactId && taxId &&
      currency === "THB" && Array.isArray(lines);
    if (!structurallyComplete || !targets.has(taxId) ||
        publishedOn < window.start || publishedOn > window.end) {
      omittedRows += Array.isArray(lines) && lines.length ? lines.length : 1;
      continue;
    }

    const statusReason = statusEligibility(kind, status, pick(document, ["statusString", "statusText"]));
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const product = lineProduct(line);
      const quantity = exactQuantity(pick(line, ["quantity", "qty"]));
      if (!product || !quantity) {
        omittedRows += 1;
        continue;
      }
      const derived = priceBeforeVat(document, line, quantity);
      if (!derived.price) {
        omittedRows += 1;
        continue;
      }
      const rawLineId = pick(line, ["id", "lineId", "itemId"]);
      const lineIdentity = String(rawLineId ?? index + 1).trim();
      if (!lineIdentity || lineIdentity.length > 160 || /[\u0000-\u001f\u007f]/.test(lineIdentity)) {
        omittedRows += 1;
        continue;
      }
      const eligible = !statusReason;
      const rawSerial = String(pick(document, ["documentSerial", "serial", "number"]) ?? "").trim();
      const documentSerial = rawSerial && rawSerial.length <= 120 && !/[\u0000-\u001f\u007f]/.test(rawSerial)
        ? rawSerial
        : null;
      const normalized = {
        document_record_id: recordId,
        line_key: `${kind === "quotations" ? "quotation" : kind === "cash_invoices" ? "cash_invoice" : "tax_invoice"}:${lineIdentity}`,
        document_serial: documentSerial,
        document_status: status,
        published_on: publishedOn,
        source_updated_at: isoTimestamp(pick(document, ["modifiedOn", "updatedOn"]), publishedOn),
        source_contact_id: contactId,
        source_contact_tax_id: taxId,
        source_sku: product.sku,
        source_unit: product.unit,
        source_quantity: quantity,
        net_unit_price: derived.price,
        currency: "THB",
        eligible,
        eligibility_reason: eligible ? null : statusReason,
      };
      const uniquenessKey = `${normalized.document_record_id}\u0000${normalized.line_key}`;
      if (rowKeys.has(uniquenessKey)) {
        throw new FlowAccountSafeError("sync_source_incomplete", 502);
      }
      rowKeys.add(uniquenessKey);
      normalized.source_hash = await sha256Hex(stableStringify(normalized));
      rows.push(normalized);
      if (rows.length > MAX_PUBLISH_ROWS) {
        throw new FlowAccountSafeError("sync_row_limit_exceeded", 413);
      }
    }
  }

  rows.sort((left, right) =>
    left.document_record_id - right.document_record_id || left.line_key.localeCompare(right.line_key));
  if (documents.length > 0 && rows.length === 0) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const sourceHash = await sha256Hex(stableStringify(rows.map((row) => row.source_hash)));
  return {
    rows,
    sourceHash,
    eligibleRows: rows.filter((row) => row.eligible).length,
    omittedRows,
    documentCount: new Set(rows.map((row) => {
      const lineKey = String(row.line_key).toLowerCase();
      const documentKind = lineKey.startsWith("quotation:") ? "quotation"
        : lineKey.startsWith("tax_invoice:") ? "tax_invoice"
        : lineKey.startsWith("cash_invoice:") ? "cash_invoice"
        : "unknown";
      return `${documentKind}\u0000${row.document_record_id}`;
    })).size,
  };
}

export async function readCompletePriceSource(client, tools, window, targetTaxIds) {
  const targets = normalizeTargetTaxIds(targetTaxIds);
  if (targets.length === 0) {
    return {
      quotations: [],
      taxInvoices: [],
      cashInvoices: [],
      prefilteredOmittedRows: 0,
    };
  }
  const selected = discoverPriceReadTools(tools);
  const detailTool = discoverSalesDocumentDetailTool(tools);
  const [quotationSummaries, taxInvoiceSummaries, cashInvoiceSummaries] = await Promise.all([
    paginateReadTool(
      client, selected.quotations,
      buildReadToolArguments(selected.quotations, "quotations", window),
    ),
    paginateReadTool(
      client, selected.tax_invoices,
      buildReadToolArguments(selected.tax_invoices, "tax_invoices", window),
    ),
    paginateReadTool(
      client, selected.cash_invoices,
      buildReadToolArguments(selected.cash_invoices, "cash_invoices", window),
    ),
  ]);
  const allSummaries = [
    ...quotationSummaries,
    ...taxInvoiceSummaries,
    ...cashInvoiceSummaries,
  ];
  const targetTaxByContactId = verifiedTargetTaxByContactId(allSummaries, targets);
  const contactIds = [...targetTaxByContactId.keys()];
  const quotationCandidates = prefilterEligibleDocumentSummaries(
    quotationSummaries, "quotations", targets, contactIds,
  );
  const taxInvoiceCandidates = prefilterEligibleDocumentSummaries(
    taxInvoiceSummaries, "tax_invoices", targets, contactIds,
  );
  const cashInvoiceCandidates = prefilterEligibleDocumentSummaries(
    cashInvoiceSummaries, "cash_invoices", targets, contactIds,
  );
  const unresolved = quotationCandidates.unresolved.length +
    taxInvoiceCandidates.unresolved.length + cashInvoiceCandidates.unresolved.length;
  if (unresolved > MAX_INFERRED_TAX_DETAILS) {
    throw new FlowAccountSafeError("sync_source_incomplete", 502);
  }
  const [quotationExact, quotationInferred, taxInvoiceExact, taxInvoiceInferred,
    cashInvoiceExact, cashInvoiceInferred] = await Promise.all([
    hydrateSalesDocumentDetails(
      client, detailTool, quotationCandidates.candidates, "quotations", targets,
    ),
    hydrateInferredTaxDetails(
      client, detailTool, quotationCandidates.unresolved, "quotations",
      targets, targetTaxByContactId,
    ),
    hydrateSalesDocumentDetails(
      client, detailTool, taxInvoiceCandidates.candidates, "tax_invoices", targets,
    ),
    hydrateInferredTaxDetails(
      client, detailTool, taxInvoiceCandidates.unresolved, "tax_invoices",
      targets, targetTaxByContactId,
    ),
    hydrateSalesDocumentDetails(
      client, detailTool, cashInvoiceCandidates.candidates, "cash_invoices", targets,
    ),
    hydrateInferredTaxDetails(
      client, detailTool, cashInvoiceCandidates.unresolved, "cash_invoices",
      targets, targetTaxByContactId,
    ),
  ]);
  return {
    quotations: [...quotationExact, ...quotationInferred],
    taxInvoices: [...taxInvoiceExact, ...taxInvoiceInferred],
    cashInvoices: [...cashInvoiceExact, ...cashInvoiceInferred],
    prefilteredOmittedRows: quotationCandidates.omittedRows +
      taxInvoiceCandidates.omittedRows + cashInvoiceCandidates.omittedRows,
  };
}

export function assertConfiguredCompanyKey(value, configured = "jnac-thailand") {
  const companyKey = String(value ?? "").trim();
  if (!companyKey) throw new FlowAccountSafeError("company_key_required", 400);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(companyKey) || companyKey !== configured) {
    throw new FlowAccountSafeError("invalid_company_key", 403);
  }
  return companyKey;
}

export function trustedReturnUrl(raw, result = "connected", allowedHosts = []) {
  const fallback = new URL("https://www.jnac.online/center/settings");
  let target;
  try {
    target = raw ? new URL(raw) : fallback;
  } catch {
    target = fallback;
  }
  const hosts = new Set(["www.jnac.online", "jnac.online", "localhost", "127.0.0.1", ...allowedHosts]);
  const localHttp = target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname);
  if (!hosts.has(target.hostname) || (target.protocol !== "https:" && !localHttp)) target = fallback;
  target.hash = "";
  target.searchParams.set("flowaccount", result === "connected" ? "connected" : "error");
  return target.toString();
}

export const FLOWACCOUNT_LIMITS = Object.freeze({
  maxPublishRows: MAX_PUBLISH_ROWS,
  maxToolPages: MAX_TOOL_PAGES,
  maxToolRecords: MAX_TOOL_RECORDS,
});
