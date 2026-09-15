import { supabase } from './supabase';

export interface FlowAccountMcpStatus {
  company_key: string;
  connected: boolean;
  status: 'disconnected' | 'connecting' | 'connected' | 'error' | string;
  provider_company_name: string | null;
  scopes: string[];
  token_expires_at: string | null;
  connected_at: string | null;
  refreshed_at: string | null;
  last_error_code: string | null;
  sync_enabled: boolean;
  last_success_at: string | null;
  last_sync_status: string | null;
  last_sync_imported_rows: number;
  last_sync_eligible_rows: number;
  last_sync_excluded_rows: number;
}

export interface FlowAccountSyncResult {
  imported_rows: number;
  eligible_rows: number;
  excluded_rows: number;
  last_success_at: string;
}

const FLOWACCOUNT_COMPANY_KEY = 'jnac-thailand';

async function invokeFlowAccountFunction(
  functionName: 'flowaccount-mcp-oauth-start' | 'flowaccount-price-sync',
  body: Record<string, unknown>,
) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let message = error.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { message = (await (error as any).context?.json?.())?.error_code ?? message; } catch { /* ignore */ }
    throw new Error(message);
  }
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) throw new Error(String(result?.error_code ?? 'flowaccount_request_failed'));
  return result;
}

export const flowAccountMcpApi = {
  async getStatus(): Promise<FlowAccountMcpStatus> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc('get_flowaccount_mcp_status', {
      p_company_key: FLOWACCOUNT_COMPANY_KEY,
    });
    if (error) throw error;
    const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const sync = (raw.sync && typeof raw.sync === 'object' && !Array.isArray(raw.sync)
      ? raw.sync
      : {}) as Record<string, unknown>;
    const latestRun = (sync.latest_run && typeof sync.latest_run === 'object' && !Array.isArray(sync.latest_run)
      ? sync.latest_run
      : {}) as Record<string, unknown>;
    return {
      company_key: FLOWACCOUNT_COMPANY_KEY,
      connected: raw.connected === true || raw.status === 'connected',
      status: String(raw.status ?? 'disconnected'),
      provider_company_name: raw.provider_company_name ? String(raw.provider_company_name) : null,
      scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : [],
      token_expires_at: raw.token_expires_at ? String(raw.token_expires_at) : null,
      connected_at: raw.connected_at ? String(raw.connected_at) : null,
      refreshed_at: raw.refreshed_at ? String(raw.refreshed_at) : null,
      last_error_code: raw.last_error_code ? String(raw.last_error_code) : null,
      sync_enabled: sync.enabled === true,
      last_success_at: sync.last_success_at ? String(sync.last_success_at) : null,
      last_sync_status: latestRun.status ? String(latestRun.status) : null,
      last_sync_imported_rows: Number(latestRun.row_count ?? 0),
      last_sync_eligible_rows: Number(latestRun.eligible_count ?? 0),
      last_sync_excluded_rows: Number(latestRun.rejected_count ?? 0) + Number(latestRun.omitted_count ?? 0),
    };
  },

  async startConnection(returnTo: string): Promise<string> {
    const result = await invokeFlowAccountFunction('flowaccount-mcp-oauth-start', {
      company_key: FLOWACCOUNT_COMPANY_KEY,
      return_to: returnTo,
    });
    const authorizationUrl = String(result.authorization_url ?? '');
    if (!authorizationUrl.startsWith('https://')) throw new Error('invalid_authorization_url');
    return authorizationUrl;
  },

  async syncNow(): Promise<FlowAccountSyncResult> {
    const result = await invokeFlowAccountFunction('flowaccount-price-sync', {
      company_key: FLOWACCOUNT_COMPANY_KEY,
    });
    return {
      imported_rows: Number(result.imported_rows ?? 0),
      eligible_rows: Number(result.eligible_rows ?? 0),
      excluded_rows: Number(result.excluded_rows ?? 0),
      last_success_at: String(result.last_success_at ?? new Date().toISOString()),
    };
  },

  async disconnect(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.rpc('disconnect_flowaccount_mcp', {
      p_company_key: FLOWACCOUNT_COMPANY_KEY,
    });
    if (error) throw error;
    if (data !== true) throw new Error('flowaccount_disconnect_failed');
  },
};
