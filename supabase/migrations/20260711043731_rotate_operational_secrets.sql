-- Keep operational credentials out of tracked SQL. The matching values are
-- stored in Supabase Vault and read only by these SECURITY DEFINER functions.

create or replace function public.notify_team_on_agent_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'NOTIFY_TEAM_KEY'
   order by created_at desc
   limit 1;

  if v_key is null or v_key = '' then
    return new;
  end if;

  if new.status = 'proposed' and new.kind in
     ('sales.quote_request', 'sales.lead', 'ops.verify_customer_link', 'sales.quote_response')
  then
    perform net.http_post(
      url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/notify-team',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notify-key', v_key),
      body := jsonb_build_object('task_id', new.id)
    );
  end if;

  return new;
exception when others then
  return new;
end;
$$;

revoke execute on function public.notify_team_on_agent_task() from public, anon, authenticated;
grant execute on function public.notify_team_on_agent_task() to service_role;

create or replace function public.agent_run_monthly_review_internal(p_days int default 30)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'MONTHLY_REVIEW_KEY'
   order by created_at desc
   limit 1;

  if v_key is null or v_key = '' then
    return;
  end if;

  perform net.http_post(
    url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/monthly-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-review-key', v_key),
    body := jsonb_build_object('days', p_days)
  );
exception when others then
  null;
end;
$$;

revoke execute on function public.agent_run_monthly_review_internal(int) from public, anon, authenticated;
grant execute on function public.agent_run_monthly_review_internal(int) to service_role;

create or replace function public.notify_storefront_revalidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'REVALIDATE_SECRET'
   order by created_at desc
   limit 1;

  if v_key is null or v_key = '' then
    return null;
  end if;

  perform net.http_post(
    url := 'https://www.jnac.online/api/revalidate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-revalidate-secret', v_key),
    body := jsonb_build_object('source', TG_TABLE_NAME, 'op', TG_OP)
  );

  return null;
exception when others then
  return null;
end;
$$;

revoke execute on function public.notify_storefront_revalidate() from public, anon, authenticated;
grant execute on function public.notify_storefront_revalidate() to service_role;
