-- Supabase grants the postgres migration role read/delete access to vault.secrets,
-- while vault.create_secret/update_secret perform writes through their own
-- security-definer functions. A SELECT ... FOR UPDATE therefore fails even
-- though the supported Vault write functions are callable. Serialize writes
-- with an advisory transaction lock and keep the lookup read-only.

create or replace function public.set_flowaccount_mcp_secret(
  p_name text,
  p_value text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_name is null
     or not pricing_private.flowaccount_public_secret_name_is_allowed(p_name)
     or p_value is null
     or char_length(p_value) not between 1 and 8192 then
    raise exception 'invalid_flowaccount_secret'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('flowaccount_mcp.secret.' || p_name, 0)
  );

  select secret.id into v_secret_id
  from vault.secrets as secret
  where secret.name = p_name
  order by secret.created_at desc
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(p_value, p_name, 'CoreBiz FlowAccount MCP credential');
  else
    perform vault.update_secret(
      v_secret_id,
      p_value,
      p_name,
      'CoreBiz FlowAccount MCP credential'
    );
  end if;
  return true;
end;
$$;

revoke all on function public.set_flowaccount_mcp_secret(text, text)
  from public, anon, authenticated;
grant execute on function public.set_flowaccount_mcp_secret(text, text)
  to service_role;

