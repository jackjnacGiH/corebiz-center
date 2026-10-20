-- Avoid no-op proposal writes without disabling shared bot/quote tasks.
create or replace function public.agent_propose(
  p_category          text,
  p_kind              text,
  p_title             text,
  p_summary           text     default null,
  p_recommendation    text     default null,
  p_payload           jsonb    default '{}'::jsonb,
  p_action_kind       text     default 'none',
  p_requires_approval boolean  default true,
  p_priority          smallint default 2,
  p_related_type      text     default null,
  p_related_id        text     default null,
  p_dedupe_key        text     default null,
  p_source            text     default 'agent'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_dedupe_key is null then
    insert into public.agent_tasks(category,kind,title,summary,recommendation,payload,action_kind,
                                    requires_approval,priority,related_type,related_id,source)
    values (p_category,p_kind,p_title,p_summary,p_recommendation,coalesce(p_payload,'{}'::jsonb),p_action_kind,
            p_requires_approval,p_priority,p_related_type,p_related_id,p_source)
    returning id into v_id;
    return v_id;
  end if;

  insert into public.agent_tasks(category,kind,title,summary,recommendation,payload,action_kind,
                                  requires_approval,priority,related_type,related_id,dedupe_key,source)
  values (p_category,p_kind,p_title,p_summary,p_recommendation,coalesce(p_payload,'{}'::jsonb),p_action_kind,
          p_requires_approval,p_priority,p_related_type,p_related_id,p_dedupe_key,p_source)
  on conflict (dedupe_key) do update
    set title          = excluded.title,
        summary        = excluded.summary,
        recommendation = excluded.recommendation,
        payload        = excluded.payload,
        priority       = excluded.priority,
        updated_at     = now()
    where public.agent_tasks.status in ('proposed','snoozed')
      and row(public.agent_tasks.title,public.agent_tasks.summary,public.agent_tasks.recommendation,public.agent_tasks.payload,public.agent_tasks.priority)
          is distinct from row(excluded.title,excluded.summary,excluded.recommendation,excluded.payload,excluded.priority)   -- only refresh still-open tasks
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.agent_tasks where dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

-- Stop repeated OAuth failures without changing pricing freshness rules.
create or replace function public.run_flowaccount_price_sync_internal()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync_key text;
  v_request_id bigint;
begin
  -- Permanent configuration errors require a reconnect/manual retry, not hourly HTTP work.
  -- A successful reconnect clears last_error_code; manual sync remains available.
  if exists (select 1 from pricing_private.flowaccount_mcp_connections
             where status='connected' and last_error_code='oauth_configuration_invalid') then
    insert into public.notifications(recipient_id,type,title,body,link,metadata)
    select p.id,'system','พักการ sync ราคา FlowAccount อัตโนมัติ',
      'การตั้งค่า OAuth ไม่ถูกต้อง กรุณาตรวจการเชื่อมต่อ FlowAccount แล้วเชื่อมต่อใหม่หรือกด sync เอง',
      '/settings',jsonb_build_object('event','flowaccount_oauth_sync_paused')
    from public.profiles p
    where p.is_active and p.role in ('owner','admin') and not exists (
      select 1 from public.notifications n
      where n.recipient_id=p.id and n.metadata->>'event'='flowaccount_oauth_sync_paused'
        and n.created_at >= (select max(updated_at) from pricing_private.flowaccount_mcp_connections
                             where status='connected' and last_error_code='oauth_configuration_invalid')
    );
    return null;
  end if;
  if not exists (
    select 1
    from pricing_private.flowaccount_mcp_connections as connection
    where connection.status = 'connected'
  ) or not exists (
    select 1
    from vault.secrets as secret
    where secret.name = 'FLOWACCOUNT_MCP_REFRESH_TOKEN'
  ) then
    return null;
  end if;

  select secret.decrypted_secret into v_sync_key
  from vault.decrypted_secrets as secret
  where secret.name = 'FLOWACCOUNT_MCP_SYNC_KEY'
  order by secret.created_at desc
  limit 1;

  if nullif(v_sync_key, '') is null then
    return null;
  end if;

  select net.http_post(
    url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/flowaccount-price-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flowaccount-sync-key', v_sync_key
    ),
    body := '{}'::jsonb
  ) into v_request_id;
  return v_request_id;
exception when others then
  return null;
end;
$$;

-- Preserve automatic shipping/chat work and existing cron frequencies.
-- The history cron is activated only after the private backup is verified.
create schema if not exists maintenance_private;
revoke all on schema maintenance_private from public, anon, authenticated;

create table maintenance_private.history_archives (
  object_path text primary key,
  source text not null check (source in ('inventory','cron')),
  cutoff timestamptz not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer not null check (byte_length > 0),
  archived_rows integer not null check (archived_rows between 1 and 500),
  deleted_rows integer not null default 0,
  verified_at timestamptz not null default statement_timestamp()
);
alter table maintenance_private.history_archives enable row level security;
revoke all on maintenance_private.history_archives from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'MAINTENANCE_ARCHIVE_KEY') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'MAINTENANCE_ARCHIVE_KEY');
  end if;
end $$;

create or replace function public.get_maintenance_archive_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'MAINTENANCE_ARCHIVE_KEY' order by created_at desc limit 1;
$$;

create or replace function public.read_history_archive_batch(p_source text, p_cutoff timestamptz, p_limit integer default 500)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if p_cutoff is null or p_cutoff > statement_timestamp() - interval '60 days'
     or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid_history_archive_request';
  end if;
  if p_source = 'inventory' then
    select jsonb_agg(to_jsonb(r)) into v_rows from (
      select * from public.inventory_sync_logs where finished_at < p_cutoff
      order by finished_at,id limit p_limit
    ) r;
  elsif p_source = 'cron' then
    select jsonb_agg(to_jsonb(r)) into v_rows from (
      select * from cron.job_run_details where end_time < p_cutoff
      order by end_time,runid limit p_limit
    ) r;
  else raise exception 'invalid_history_archive_source';
  end if;
  return coalesce(v_rows,'[]'::jsonb);
end $$;

create or replace function public.commit_history_archive_batch(
  p_source text, p_cutoff timestamptz, p_rows jsonb, p_object_path text,
  p_sha256 text, p_bytes integer, p_delete boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_deleted integer := 0; v_count integer;
begin
  if p_source is null or p_source not in ('inventory','cron') or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or p_cutoff is null
     or p_cutoff > statement_timestamp() - interval '60 days'
     or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_bytes is null or p_bytes <= 0 or p_delete is null then
    raise exception 'invalid_verified_history_archive';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count not between 1 and 500 or p_object_path is null
     or p_object_path !~ ('^' || p_source || '/[0-9]{4}-[0-9]{2}-[0-9]{2}/' || p_sha256 || '[.]json[.]gz$') then
    raise exception 'invalid_verified_history_archive';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='maintenance-history' and name=p_object_path) then
    raise exception 'verified_history_archive_object_missing';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_object_path,0));
  insert into maintenance_private.history_archives(object_path,source,cutoff,sha256,byte_length,archived_rows)
    values(p_object_path,p_source,p_cutoff,p_sha256,p_bytes,v_count)
    on conflict (object_path) do nothing;
  if p_delete then
    -- Match the entire archived row: concurrent edits are retained, never lost.
    if p_source = 'inventory' then
      delete from public.inventory_sync_logs s using jsonb_array_elements(p_rows) a
      where s.id=(a->>'id')::uuid and s.finished_at<p_cutoff and to_jsonb(s)=a;
    else
      delete from cron.job_run_details s using jsonb_array_elements(p_rows) a
      where s.runid=(a->>'runid')::bigint and s.end_time<p_cutoff and to_jsonb(s)=a;
    end if;
    get diagnostics v_deleted = row_count;
    update maintenance_private.history_archives
      set deleted_rows=deleted_rows+v_deleted where object_path=p_object_path;
  end if;
  return jsonb_build_object('source',p_source,'object_path',p_object_path,'archived_rows',v_count,'deleted_rows',v_deleted,'sha256',p_sha256);
end $$;

create or replace function public.run_history_archive_internal(p_archive_only boolean default false, p_dry_run boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_request bigint; v_key text;
begin
  v_key := public.get_maintenance_archive_key();
  if nullif(v_key,'') is null then return null; end if;
  select net.http_post(
    url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/archive-maintenance-history',
    headers := jsonb_build_object('Content-Type','application/json','x-maintenance-key',v_key),
    body := jsonb_build_object('archive_only',p_archive_only,'dry_run',p_dry_run),
    timeout_milliseconds := 120000
  ) into v_request;
  return v_request;
end $$;

revoke all on function public.get_maintenance_archive_key() from public, anon, authenticated;
revoke all on function public.read_history_archive_batch(text,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.commit_history_archive_batch(text,timestamptz,jsonb,text,text,integer,boolean) from public, anon, authenticated;
revoke all on function public.run_history_archive_internal(boolean,boolean) from public, anon, authenticated;
grant execute on function public.get_maintenance_archive_key() to service_role;
grant execute on function public.read_history_archive_batch(text,timestamptz,integer) to service_role;
grant execute on function public.commit_history_archive_batch(text,timestamptz,jsonb,text,text,integer,boolean) to service_role;
grant execute on function public.run_history_archive_internal(boolean,boolean) to service_role;

do $$ declare v_job bigint; begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    select cron.schedule('history-archive-daily','23 20 * * *','select public.run_history_archive_internal();') into v_job;
    perform cron.alter_job(v_job,active:=false);
  end if;
end $$;
