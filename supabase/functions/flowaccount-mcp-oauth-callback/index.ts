import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {
  FLOWACCOUNT_VAULT_NAMES,
  FlowAccountSafeError,
  McpStreamableClient,
  assertConfiguredCompanyKey,
  assertExpectedCompany,
  discoverCurrentCompany,
  discoverFlowAccountOAuth,
  exchangeAuthorizationCode,
  isValidOAuthState,
  safeErrorCode,
  sha256Hex,
  trustedReturnUrl,
  validateConsumedOAuthState,
} from "../_shared/flowaccount-mcp.mjs";

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new FlowAccountSafeError("database_rpc_failed", 500);
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpcValue(admin: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new FlowAccountSafeError("database_rpc_failed", 500);
  return data;
}

async function vaultGet(admin: SupabaseClient, name: string) {
  const value = await rpcValue(admin, "get_flowaccount_mcp_secret", { p_name: name });
  return typeof value === "string" ? value.trim() : "";
}

async function vaultSet(admin: SupabaseClient, name: string, value: string) {
  const stored = await rpcValue(admin, "set_flowaccount_mcp_secret", {
    p_name: name,
    p_value: value,
  });
  if (stored !== true) throw new FlowAccountSafeError("database_rpc_failed", 500);
}

function callbackUri() {
  const configured = Deno.env.get("FLOWACCOUNT_MCP_REDIRECT_URI")?.trim();
  if (configured) return configured;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  if (!supabaseUrl) throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
  return `${supabaseUrl}/functions/v1/flowaccount-mcp-oauth-callback`;
}

function resultRedirect(result: "connected" | "error") {
  const allowlist = (Deno.env.get("FLOWACCOUNT_MCP_RETURN_HOSTS") ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return trustedReturnUrl(Deno.env.get("FLOWACCOUNT_MCP_RETURN_URL"), result, allowlist);
}

function redirect(result: "connected" | "error") {
  return new Response(null, {
    status: 302,
    headers: {
      Location: resultRedirect(result),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function updateConnectionError(admin: SupabaseClient, companyKey: string, code: string) {
  await admin.rpc("upsert_flowaccount_mcp_connection", {
    p_company_key: companyKey,
    p_status: "error",
    p_provider_company_id: null,
    p_provider_company_name: null,
    p_scopes: [],
    p_token_expires_at: null,
    p_last_error_code: code,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return new Response(null, { status: 405, headers: { "Cache-Control": "no-store" } });
  let admin: SupabaseClient | null = null;
  let companyKey: string | null = null;
  try {
    admin = adminClient();
    const url = new URL(req.url);
    const state = url.searchParams.get("state") ?? "";
    if (!isValidOAuthState(state)) throw new FlowAccountSafeError("invalid_oauth_state", 400);
    const stateHash = await sha256Hex(state);
    const consumed = validateConsumedOAuthState(await rpcValue(
      admin,
      "consume_flowaccount_mcp_oauth_state",
      { p_state_hash: stateHash, p_consumed_at: new Date().toISOString() },
    ));
    const configuredCompany = Deno.env.get("FLOWACCOUNT_MCP_COMPANY_KEY")?.trim() || "jnac-thailand";
    companyKey = assertConfiguredCompanyKey(consumed.company_key, configuredCompany);
    if (consumed.redirect_uri !== callbackUri()) {
      throw new FlowAccountSafeError("invalid_oauth_callback", 400);
    }
    if (url.searchParams.has("error")) throw new FlowAccountSafeError("oauth_denied", 400);
    const code = url.searchParams.get("code")?.trim() ?? "";
    if (!code || code.length > 4_096) throw new FlowAccountSafeError("invalid_oauth_callback", 400);

    const metadata = await discoverFlowAccountOAuth(fetch);
    const clientId = await vaultGet(admin, FLOWACCOUNT_VAULT_NAMES.clientId);
    if (!clientId) throw new FlowAccountSafeError("oauth_configuration_invalid", 500);
    const token = await exchangeAuthorizationCode(fetch, metadata, {
      clientId,
      redirectUri: consumed.redirect_uri,
      codeVerifier: consumed.code_verifier,
      code,
    });
    if (!token.refreshToken) throw new FlowAccountSafeError("oauth_token_exchange_failed", 502);

    const client = new McpStreamableClient({ accessToken: token.accessToken });
    await client.initialize();
    const tools = await client.listTools();
    const currentCompany = await discoverCurrentCompany(client, tools);
    assertExpectedCompany(currentCompany, {
      id: Deno.env.get("FLOWACCOUNT_MCP_EXPECTED_COMPANY_ID"),
      name: Deno.env.get("FLOWACCOUNT_MCP_EXPECTED_COMPANY_NAME"),
    });

    // Store the rotated/long-lived credential first; an access-token write can be retried.
    await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.refreshToken, token.refreshToken);
    await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.accessToken, token.accessToken);
    const connected = await rpcValue(admin, "upsert_flowaccount_mcp_connection", {
      p_company_key: companyKey,
      p_status: "connected",
      p_provider_company_id: currentCompany.providerCompanyId,
      p_provider_company_name: currentCompany.providerCompanyName,
      p_scopes: token.scopes,
      p_token_expires_at: token.expiresAt,
      p_last_error_code: null,
    });
    if (connected !== true) throw new FlowAccountSafeError("database_rpc_failed", 500);
    return redirect("connected");
  } catch (error) {
    const code = safeErrorCode(error, "invalid_oauth_callback");
    if (admin && companyKey) await updateConnectionError(admin, companyKey, code).catch(() => undefined);
    return redirect("error");
  }
});
