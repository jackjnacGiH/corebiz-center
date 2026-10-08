-- Durable inbound/reply ledger. No platform token is persisted. Retries reuse
-- a prepared response; ambiguous external sends require review, not re-send.
create table public.chat_delivery_events (
  channel text not null check (channel in ('line','messenger')),
  event_key text not null check (length(event_key) between 1 and 200),
  request_id uuid not null default gen_random_uuid(),
  claim_token uuid,
  state text not null default 'received' check (state in ('received','processing','reply_pending','sending','delivered','ignored','failed','delivery_unknown','processing_unknown')),
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  reply_text text,
  reply_metadata jsonb not null default '{}',
  attempts integer not null default 0,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (channel,event_key)
);
alter table public.chat_delivery_events enable row level security;
revoke all on public.chat_delivery_events from public,anon,authenticated;
grant all on public.chat_delivery_events to service_role;
create index chat_delivery_recovery_idx on public.chat_delivery_events(updated_at)
where state in ('failed','reply_pending','delivery_unknown','processing_unknown');

create function public.claim_chat_delivery_event(p_channel text,p_event_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.chat_delivery_events; next_token uuid:=gen_random_uuid(); inserted_count integer;
  legacy_message_id text; legacy_conversation_id uuid;
begin
  insert into public.chat_delivery_events(channel,event_key) values(p_channel,p_event_key) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  select * into r from public.chat_delivery_events where channel=p_channel and event_key=p_event_key for update;
  if inserted_count = 1 then
    legacy_message_id := case
      when p_channel='line' then p_event_key
      when p_channel='messenger' and p_event_key like 'inbox.%' then substr(p_event_key,7)
      when p_channel='messenger' and p_event_key like 'comment.%' then 'facebook-comment:'||substr(p_event_key,9)
      else null end;
    -- Before this ledger existed, a stored inbound row cannot prove whether
    -- RAG already created a quote or the platform accepted the old reply.
    -- New Facebook handlers mark their pre-claim inbound INSERT explicitly.
    select m.conversation_id into legacy_conversation_id from public.chat_messages m
      join public.chat_conversations c on c.id=m.conversation_id
      where c.channel=p_channel and m.sender_type='customer'
        and m.external_msg_id=legacy_message_id
        and coalesce(m.metadata->>'delivery_ledger_version','')<>'1'
      order by m.created_at desc,m.id desc limit 1;
    if legacy_conversation_id is not null then
      update public.chat_delivery_events set state='processing_unknown',conversation_id=legacy_conversation_id,
        last_error='legacy_event_requires_review',lease_until=null,updated_at=now()
        where channel=p_channel and event_key=p_event_key returning * into r;
      return to_jsonb(r)||jsonb_build_object('action','review');
    end if;
  end if;
  if r.state in ('delivered','ignored') then return to_jsonb(r)||jsonb_build_object('action','completed'); end if;
  if r.lease_until>now() then return to_jsonb(r)||jsonb_build_object('action','busy'); end if;
  if r.state in ('sending','delivery_unknown','processing_unknown') or (r.reply_metadata->>'work_started'='true' and r.reply_text is null) then
    update public.chat_delivery_events set state=case when reply_text is null then 'processing_unknown' else 'delivery_unknown' end,updated_at=now(),lease_until=null where channel=p_channel and event_key=p_event_key returning * into r;
    return to_jsonb(r)||jsonb_build_object('action','review');
  end if;
  update public.chat_delivery_events set claim_token=next_token,attempts=attempts+1,
    state=case when reply_text is null then 'processing' else 'reply_pending' end,
    lease_until=now()+interval '3 minutes',updated_at=now()
  where channel=p_channel and event_key=p_event_key returning * into r;
  return to_jsonb(r)||jsonb_build_object('action','claimed');
end $$;
create function public.update_chat_delivery_event(p_channel text,p_event_key text,p_claim_token uuid,p_state text,
  p_conversation_id uuid default null,p_reply_text text default null,p_reply_metadata jsonb default null,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.chat_delivery_events;
begin
  if p_state not in ('processing','reply_pending','sending','delivered','ignored','failed','delivery_unknown','processing_unknown') then raise exception 'invalid_delivery_state'; end if;
  update public.chat_delivery_events set state=p_state,
    conversation_id=coalesce(p_conversation_id,conversation_id),reply_text=coalesce(p_reply_text,reply_text),
    reply_metadata=coalesce(p_reply_metadata,reply_metadata),last_error=left(p_error,100),updated_at=now(),
    lease_until=case when p_state in ('delivered','ignored','failed','reply_pending','delivery_unknown','processing_unknown') then null else now()+interval '3 minutes' end
  where channel=p_channel and event_key=p_event_key and claim_token=p_claim_token returning * into r;
  if not found then raise exception 'delivery_claim_conflict'; end if;
  return to_jsonb(r);
end $$;
revoke all on function public.claim_chat_delivery_event(text,text) from public,anon,authenticated;
revoke all on function public.update_chat_delivery_event(text,text,uuid,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_chat_delivery_event(text,text) to service_role;
grant execute on function public.update_chat_delivery_event(text,text,uuid,text,uuid,text,jsonb,text) to service_role;

create function public.complete_chat_delivery_event(p_channel text,p_event_key text,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.chat_delivery_events;
begin
  select * into r from public.chat_delivery_events where channel=p_channel and event_key=p_event_key
    and claim_token=p_claim_token and state='sending' for update;
  if not found or r.conversation_id is null or r.reply_text is null then raise exception 'delivery_claim_conflict'; end if;
  if r.reply_metadata ? 'staff_message_id' then
    update public.chat_messages set metadata=coalesce(metadata,'{}')||jsonb_build_object('outbound_delivery','delivered','messenger_push_failed',false)
      where id=(r.reply_metadata->>'staff_message_id')::uuid and conversation_id=r.conversation_id and sender_type='agent';
    if not found then raise exception 'staff_message_missing'; end if;
  else
    insert into public.chat_messages(conversation_id,sender_type,content,content_type,external_msg_id,metadata)
      values(r.conversation_id,'bot',r.reply_text,'text','bot.'||p_channel||':'||p_event_key,r.reply_metadata)
      on conflict do nothing;
  end if;
  update public.chat_delivery_events set state='delivered',lease_until=null,last_error=null,updated_at=now()
    where channel=p_channel and event_key=p_event_key returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.complete_chat_delivery_event(text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_chat_delivery_event(text,text,uuid) to service_role;

create function public.list_chat_delivery_recovery(p_conversation_id uuid)
returns table(event_key text,state text,reply_text text,updated_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_write() then raise exception 'forbidden'; end if;
  return query select e.event_key,
    case when e.state='sending' then 'delivery_unknown'
      when e.state='processing' and e.reply_metadata->>'work_started'='true' then 'processing_unknown'
      when e.state='processing' then 'failed' else e.state end,
    e.reply_text,e.updated_at from public.chat_delivery_events e
    where e.conversation_id=p_conversation_id and (e.state in ('failed','reply_pending','processing_unknown','delivery_unknown')
      or (e.state in ('processing','sending') and e.lease_until<=now()))
    order by e.updated_at desc limit 10;
end $$;
revoke all on function public.list_chat_delivery_recovery(uuid) from public,anon;
grant execute on function public.list_chat_delivery_recovery(uuid) to authenticated;

-- Closing review records a human decision only. It sends nothing and never
-- re-runs RAG/tools. Invalidate the old claim so a late worker cannot resurrect
-- an event that a staff member already handled after lease expiry.
create function public.resolve_chat_delivery_recovery(p_conversation_id uuid,p_event_key text,
  p_expected_updated_at timestamptz,p_resolution text default 'handled_by_staff')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.chat_delivery_events;
begin
  if auth.uid() is null or not public.can_write() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_resolution not in ('handled_by_staff','delivery_verified') or p_resolution is null then raise exception 'invalid_recovery_resolution'; end if;
  select * into r from public.chat_delivery_events e where e.conversation_id=p_conversation_id and e.event_key=p_event_key
    and (e.state in ('failed','reply_pending','processing_unknown','delivery_unknown')
      or (e.state in ('processing','sending') and e.lease_until<=now())) for update;
  if not found then raise exception 'delivery_recovery_not_found'; end if;
  if r.updated_at is distinct from p_expected_updated_at then raise exception 'delivery_recovery_conflict'; end if;
  update public.chat_delivery_events e set state='ignored',claim_token=null,lease_until=null,updated_at=now(),
    reply_metadata=e.reply_metadata||jsonb_build_object('reviewed_by',auth.uid(),'reviewed_at',now(),'resolution',p_resolution)
    where e.channel=r.channel and e.event_key=r.event_key returning * into r;
  return jsonb_build_object('event_key',r.event_key,'state',r.state,'updated_at',r.updated_at);
end $$;
revoke all on function public.resolve_chat_delivery_recovery(uuid,text,timestamptz,text) from public,anon;
grant execute on function public.resolve_chat_delivery_recovery(uuid,text,timestamptz,text) to authenticated;

-- Sync the existing live comment ledger into migration history for fresh
-- environments; historical rows and existing grants are preserved.
create table if not exists public.facebook_comment_events (
  comment_id text primary key,page_id text not null,post_id text,
  status text not null default 'pending',reply_id text,error_code text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.facebook_comment_events enable row level security;
revoke all on public.facebook_comment_events from public,anon,authenticated;
grant all on public.facebook_comment_events to service_role;
