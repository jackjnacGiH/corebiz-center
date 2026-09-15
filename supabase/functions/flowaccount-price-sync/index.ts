import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import {
  FLOWACCOUNT_VAULT_NAMES,
  FlowAccountSafeError,
  McpStreamableClient,
  assertConfiguredCompanyKey,
  constantTimeEqual,
  discoverCurrentCompany,
  discoverFlowAccountOAuth,
  normalizePriceGeneration,
  normalizeTargetTaxIds,
  readCompletePriceSource,
  refreshOAuthToken,
  rollingDateWindow,
  safeErrorCode,
  safeErrorStatus,
} from "../_shared/flowaccount-mcp.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-flowaccount-sync-key",
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

async function rpcValue(admin: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new FlowAccountSafeError("database_rpc_failed", 500);
  return data;
}

async function activeCustomerTargets(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("get_flowaccount_active_customer_targets", {
    p_days: 180,
    p_limit: 100,
  });
  if (error) {
    if (String(error.message ?? "").includes("flowaccount_active_customer_limit_exceeded")) {
      throw new FlowAccountSafeError("active_customer_limit_exceeded", 409);
    }
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  const value = data as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = ["target_count", "targets", "window_days"].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
      value.window_days !== 180 || !Array.isArray(value.targets)) {
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  const targetCount = Number(value.target_count);
  if (!Number.isSafeInteger(targetCount) || targetCount < 0 || targetCount > 100 ||
      targetCount !== value.targets.length) {
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  const customerIds = new Set<string>();
  const rawTaxIds: string[] = [];
  for (const item of value.targets) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new FlowAccountSafeError("database_rpc_failed", 500);
    }
    const target = item as Record<string, unknown>;
    const targetKeys = Object.keys(target).sort();
    if (targetKeys.length !== 2 || targetKeys[0] !== "customer_id" || targetKeys[1] !== "tax_id" ||
        typeof target.customer_id !== "string" || !UUID_RE.test(target.customer_id) ||
        typeof target.tax_id !== "string" || customerIds.has(target.customer_id)) {
      throw new FlowAccountSafeError("database_rpc_failed", 500);
    }
    customerIds.add(target.customer_id);
    rawTaxIds.push(target.tax_id);
  }
  return { targetCount, taxIds: normalizeTargetTaxIds(rawTaxIds) };
}

async function startSyncRun(
  admin: SupabaseClient,
  companyKey: string,
  window: { start: string; end: string },
) {
  const { data, error } = await admin.rpc("start_flowaccount_price_sync_run", {
    p_company_key: companyKey,
    p_source: "mcp",
    p_window_start: window.start,
    p_window_end: window.end,
  });
  if (error) {
    const knownInProgress = error.code === "55000" &&
      String(error.message ?? "").includes("flowaccount_sync_in_progress");
    if (knownInProgress) throw new FlowAccountSafeError("sync_in_progress", 409);
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  if (typeof data !== "string" || !data) {
    throw new FlowAccountSafeError("database_rpc_failed", 500);
  }
  return data;
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

async function authenticate(req: Request, admin: SupabaseClient) {
  const scheduledKey = req.headers.get("x-flowaccount-sync-key");
  if (scheduledKey !== null) {
    const expected = await rpcValue(admin, "get_flowaccount_mcp_sync_key", {});
    if (typeof expected !== "string" || !expected || !constantTimeEqual(scheduledKey, expected)) {
      throw new FlowAccountSafeError("forbidden", 403);
    }
    return "scheduled" as const;
  }
  await requireOwnerOrAdmin(req, admin);
  return "manual" as const;
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

function connectionIsReady(status: unknown) {
  if (!status || typeof status !== "object") return null;
  const value = status as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = [
    "connected",
    "last_success_at",
    "provider_company_id",
    "provider_company_name",
    "refresh_token_present",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  return {
    connected: value.connected === true,
    providerCompanyId: typeof value.provider_company_id === "string" ? value.provider_company_id : null,
    providerCompanyName: typeof value.provider_company_name === "string" ? value.provider_company_name : null,
    refreshTokenPresent: value.refresh_token_present === true,
    lastSuccessAt: typeof value.last_success_at === "string" ? value.last_success_at : null,
  };
}

function validPublishResult(value: unknown, runId: string) {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result).sort();
  const expected = [
    "deleted_count",
    "document_count",
    "eligible_count",
    "omitted_count",
    "published",
    "rejected_count",
    "row_count",
    "run_id",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
  const rowCount = Number(result.row_count);
  const documentCount = Number(result.document_count);
  const eligibleCount = Number(result.eligible_count);
  const rejectedCount = Number(result.rejected_count);
  const omittedCount = Number(result.omitted_count);
  const deletedCount = Number(result.deleted_count);
  if (
    result.published !== true ||
    result.run_id !== runId ||
    !Number.isSafeInteger(rowCount) || rowCount < 0 ||
    !Number.isSafeInteger(documentCount) || documentCount < 0 || documentCount > rowCount ||
    !Number.isSafeInteger(eligibleCount) || eligibleCount < 0 ||
    !Number.isSafeInteger(rejectedCount) || rejectedCount < 0 ||
    !Number.isSafeInteger(omittedCount) || omittedCount < 0 ||
    !Number.isSafeInteger(deletedCount) || deletedCount < 0 ||
    eligibleCount + rejectedCount !== rowCount
  ) return null;
  return { rowCount, documentCount, eligibleCount, rejectedCount, omittedCount, deletedCount };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error_code: "method_not_allowed" }, 405);

  let admin: SupabaseClient | null = null;
  let runId: string | null = null;
  try {
    admin = adminClient();
    const authMode = await authenticate(req, admin);
    if (Number(req.headers.get("content-length") ?? 0) > 8_192) {
      throw new FlowAccountSafeError("bad_json", 400);
    }
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      if (authMode === "manual") throw new FlowAccountSafeError("bad_json", 400);
    }
    const configuredCompany = Deno.env.get("FLOWACCOUNT_MCP_COMPANY_KEY")?.trim() || "jnac-thailand";
    const requestedCompany = body.company_key ?? (authMode === "scheduled" ? configuredCompany : null);
    const companyKey = assertConfiguredCompanyKey(requestedCompany, configuredCompany);
    const syncContext = connectionIsReady(await rpcValue(admin, "get_flowaccount_mcp_sync_context", {
      p_company_key: companyKey,
    }));
    if (!syncContext) throw new FlowAccountSafeError("database_rpc_failed", 500);
    if (!syncContext.connected) {
      if (authMode === "scheduled") {
        return json({
          ok: true,
          skipped: true,
          imported_rows: 0,
          eligible_rows: 0,
          excluded_rows: 0,
          last_success_at: syncContext?.lastSuccessAt ?? null,
        });
      }
      throw new FlowAccountSafeError("connection_required", 409);
    }
    if (!syncContext.refreshTokenPresent || !syncContext.providerCompanyId ||
        !syncContext.providerCompanyName) {
      throw new FlowAccountSafeError("connection_required", 409);
    }

    const window = rollingDateWindow(new Date(), 180);
    const activeTargets = await activeCustomerTargets(admin);
    runId = await startSyncRun(admin, companyKey, window);

    const metadata = await discoverFlowAccountOAuth(fetch);
    const clientId = await vaultGet(admin, FLOWACCOUNT_VAULT_NAMES.clientId);
    const refreshToken = await vaultGet(admin, FLOWACCOUNT_VAULT_NAMES.refreshToken);
    if (!clientId || !refreshToken) throw new FlowAccountSafeError("connection_required", 409);
    // Refresh on every run so no stale access token is ever used for an MCP call.
    const token = await refreshOAuthToken(fetch, metadata, { clientId, refreshToken });
    if (token.refreshToken) {
      await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.refreshToken, token.refreshToken);
    }
    const client = new McpStreamableClient({ accessToken: token.accessToken });
    await client.initialize();
    const discoveredTools = await client.listTools();
    const currentCompany = await discoverCurrentCompany(client, discoveredTools);
    if (
      currentCompany.providerCompanyId !== syncContext.providerCompanyId ||
      currentCompany.providerCompanyName !== syncContext.providerCompanyName
    ) {
      throw new FlowAccountSafeError("flowaccount_company_mismatch", 409);
    }
    await vaultSet(admin, FLOWACCOUNT_VAULT_NAMES.accessToken, token.accessToken);
    const refreshed = await rpcValue(admin, "upsert_flowaccount_mcp_connection", {
      p_company_key: companyKey,
      p_status: "connected",
      p_provider_company_id: syncContext.providerCompanyId,
      p_provider_company_name: syncContext.providerCompanyName,
      p_scopes: token.scopes,
      p_token_expires_at: token.expiresAt,
      p_last_error_code: null,
    });
    if (refreshed !== true) throw new FlowAccountSafeError("database_rpc_failed", 500);

    const source = await readCompletePriceSource(
      client, discoveredTools, window, activeTargets.taxIds,
    );
    const normalized = await normalizePriceGeneration({
      ...source,
      window,
      targetTaxIds: activeTargets.taxIds,
    });
    const completedAt = new Date().toISOString();
    const publishedRaw = await rpcValue(admin, "publish_flowaccount_price_sync_run", {
      p_run_id: runId,
      p_company_key: companyKey,
      p_rows: normalized.rows,
      p_source_hash: normalized.sourceHash,
      p_omitted_count: normalized.omittedRows,
      p_completed_at: completedAt,
    });
    const published = validPublishResult(publishedRaw, runId);
    if (!published || published.rowCount !== normalized.rows.length ||
        published.documentCount !== normalized.documentCount) {
      throw new FlowAccountSafeError("sync_publish_failed", 500);
    }
    const importedRows = published.rowCount - published.rejectedCount;
    return json({
      ok: true,
      imported_rows: importedRows,
      eligible_rows: published.eligibleCount,
      excluded_rows: published.omittedCount + published.rejectedCount,
      target_customer_count: activeTargets.targetCount,
      last_success_at: completedAt,
    });
  } catch (error) {
    const code = safeErrorCode(error);
    if (admin && runId) {
      try {
        await admin.rpc("fail_flowaccount_price_sync_run", {
          p_run_id: runId,
          p_error_code: code,
          p_completed_at: new Date().toISOString(),
        });
      } catch {
        // Never replace the sanitized provider error with a database detail.
      }
    }
    return json({ ok: false, error_code: code }, safeErrorStatus(error));
  }
});
