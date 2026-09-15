import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {
  FLOWACCOUNT_VAULT_NAMES,
  FlowAccountSafeError,
  assertConfiguredCompanyKey,
  buildAuthorizationUrl,
  createPkcePair,
  discoverFlowAccountOAuth,
  randomBase64Url,
  registerOAuthClient,
  safeErrorCode,
  safeErrorStatus,
  sha256Hex,
} from "../_shared/flowaccount-mcp.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new FlowAccountSafeError("database_rpc_failed", 500);
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireOwnerOrAdmin(req: Request, admin: SupabaseClient) {
  const match = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) throw new FlowAccountSafeError("unauthorized", 401);
  const { data: identity, error: identityError } = await admin.auth.getUser(token);
  if (identityError || !identity?.user) throw new FlowAccountSafeError("unauthorized", 401);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,is_active")
    .eq("id", identity.user.id)
    .maybeSingle();
  if (profileError) throw new FlowAccountSafeError("database_rpc_failed", 500);
  if (!profile?.is_active || !["owner", "admin"].includes(String(profile.role))) {
    throw new FlowAccountSafeError("forbidden", 403);
  }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error_code: "method_not_allowed" }, 405);

  try {
    const admin = adminClient();
    await requireOwnerOrAdmin(req, admin);
    if (Number(req.headers.get("content-length") ?? 0) > 8_192) {
      throw new FlowAccountSafeError("bad_json", 400);
    }
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new FlowAccountSafeError("bad_json", 400);
    }
    const configuredCompany = Deno.env.get("FLOWACCOUNT_MCP_COMPANY_KEY")?.trim() || "jnac-thailand";
    const companyKey = assertConfiguredCompanyKey(body.company_key, configuredCompany);
    // `return_to` is accepted for frontend compatibility but never trusted for redirects.
    void body.return_to;

    const redirectUri = callbackUri();
    const metadata = await discoverFlowAccountOAuth(fetch);
    let clientId = await vaultGet(admin, FLOWACCOUNT_VAULT_NAMES.clientId);
    if (!clientId) {
      const registration = await registerOAuthClient(fetch, metadata, redirectUri);
      await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.clientId, registration.clientId);
      if (registration.clientSecret) {
        await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.clientSecret, registration.clientSecret);
      }
      clientId = registration.clientId;
    }

    const state = randomBase64Url(32);
    const stateHash = await sha256Hex(state);
    const pkce = await createPkcePair();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const stateId = await rpcValue(admin, "create_flowaccount_mcp_oauth_state", {
      p_state_hash: stateHash,
      p_code_verifier: pkce.verifier,
      p_company_key: companyKey,
      p_redirect_uri: redirectUri,
      p_expires_at: expiresAt,
    });
    if (typeof stateId !== "string" || !stateId) {
      throw new FlowAccountSafeError("oauth_state_create_failed", 500);
    }

    const connectionUpdated = await rpcValue(admin, "upsert_flowaccount_mcp_connection", {
      p_company_key: companyKey,
      p_status: "connecting",
      p_provider_company_id: null,
      p_provider_company_name: null,
      p_scopes: [],
      p_token_expires_at: null,
      p_last_error_code: null,
    });
    if (connectionUpdated !== true) throw new FlowAccountSafeError("database_rpc_failed", 500);

    const authorizationUrl = buildAuthorizationUrl(metadata, {
      clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    });
    return json({ ok: true, authorization_url: authorizationUrl });
  } catch (error) {
    return json(
      { ok: false, error_code: safeErrorCode(error) },
      safeErrorStatus(error),
    );
  }
});
