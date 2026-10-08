-- Audit groups 1/2: fail-closed profile updates, non-readable LINE secrets,
-- atomic versioned knowledge replacement, embedding budgets, private uploads.
-- Existing public attachment URLs remain valid for compatibility. New uploads
-- use chat-private-attachments; historical migration is a separate opt-in job.

create or replace function public.guard_profile_identity_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' and not public.can_delete()
     and (to_jsonb(new) - array['full_name','avatar_url','phone','language','updated_at'])
         is distinct from
         (to_jsonb(old) - array['full_name','avatar_url','phone','language','updated_at']) then
    raise exception 'profile_identity_update_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_identity_update() from public, anon, authenticated;
drop trigger if exists guard_profile_identity_update on public.profiles;
create trigger guard_profile_identity_update before update on public.profiles
for each row execute function public.guard_profile_identity_update();

-- Auth JWTs already issued must also be checked against is_active by sensitive
-- handlers/RLS. Revoking sessions prevents future refreshes (does not pretend
-- to invalidate JWT signatures). Only the service-role admin-users handler calls.
create or replace function public.revoke_user_sessions_internal(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.revoke_user_sessions_internal(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions_internal(uuid) to service_role;

-- Column grants prevent REST credential reads even by Owner/Admin. Credentials
-- remain write-only from Settings and readable only to service-role integrations.
revoke select on public.line_channels from public, anon, authenticated;
revoke select (channel_access_token, channel_secret) on public.line_channels from public, anon, authenticated;
grant select (id,name,channel_id,is_active,notes,created_at,updated_at) on public.line_channels to authenticated;
create or replace function public.list_line_channel_metadata()
returns table(id uuid,name text,channel_id text,is_active boolean,notes text,created_at timestamptz,updated_at timestamptz,token_configured boolean,secret_configured boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_read() then raise exception 'forbidden' using errcode='42501'; end if;
  return query select c.id,c.name,c.channel_id,c.is_active,c.notes,c.created_at,c.updated_at,
    length(coalesce(c.channel_access_token,''))>0,length(coalesce(c.channel_secret,''))>0
    from public.line_channels c order by c.is_active desc,c.created_at desc,c.id;
end;
$$;
revoke all on function public.list_line_channel_metadata() from public, anon;
grant execute on function public.list_line_channel_metadata() to authenticated;

create table if not exists public.knowledge_revisions (
  id uuid primary key default gen_random_uuid(), source_path text not null,
  previous_chunks jsonb not null, actor_id uuid, created_at timestamptz not null default now()
);
alter table public.knowledge_revisions enable row level security;
revoke all on public.knowledge_revisions from public, anon, authenticated;
grant all on public.knowledge_revisions to service_role;
create index if not exists knowledge_revisions_source_created_idx on public.knowledge_revisions(source_path,created_at desc);

create or replace function public.replace_knowledge_atomic(p_source_path text,p_rows jsonb,p_actor_id uuid)
returns table(id uuid) language plpgsql security definer set search_path = public as $$
declare previous jsonb; chunk public.knowledge_chunks;
begin
  if coalesce(auth.role(),'') <> 'service_role' or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.is_active and p.role in ('owner','admin')) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if length(trim(p_source_path)) not between 1 and 512 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'invalid_knowledge_rows'; end if;
  perform pg_advisory_xact_lock(hashtextextended('knowledge:'||p_source_path,0));
  select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) into previous from public.knowledge_chunks k where k.source_path=p_source_path;
  insert into public.knowledge_revisions(source_path,previous_chunks,actor_id) values(p_source_path,previous,p_actor_id);
  delete from public.knowledge_chunks k where k.source_path=p_source_path;
  for chunk in select * from jsonb_populate_recordset(null::public.knowledge_chunks,p_rows) loop
    if chunk.source_path is distinct from p_source_path or length(trim(chunk.content))=0 or chunk.embedding is null then raise exception 'invalid_knowledge_chunk'; end if;
    return query insert into public.knowledge_chunks(source_path,source_type,category,title,content,metadata,embedding,language,chunk_index,content_hash,token_count,tags,visibility,embedding_model,embedding_dimensions,embedding_version,embedded_at)
      values(p_source_path,coalesce(chunk.source_type,'manual'),chunk.category,chunk.title,chunk.content,coalesce(chunk.metadata,'{}'),chunk.embedding,coalesce(chunk.language,'th'),chunk.chunk_index,chunk.content_hash,chunk.token_count,coalesce(chunk.tags,'{}'),coalesce(chunk.visibility,'public'),'text-embedding-3-small',1536,'openai-1536-v1',now()) returning knowledge_chunks.id;
  end loop;
  delete from public.knowledge_revisions r where r.source_path=p_source_path and r.id not in
    (select r2.id from public.knowledge_revisions r2 where r2.source_path=p_source_path order by r2.created_at desc,r2.id desc limit 10);
end;
$$;
revoke all on function public.replace_knowledge_atomic(text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.replace_knowledge_atomic(text,jsonb,uuid) to service_role;

create table if not exists public.embedding_request_budgets (
  actor_key text not null, window_start timestamptz not null, requests integer not null,
  characters bigint not null, primary key(actor_key,window_start)
);
alter table public.embedding_request_budgets enable row level security;
revoke all on public.embedding_request_budgets from public, anon, authenticated;
grant all on public.embedding_request_budgets to service_role;
create or replace function public.consume_embedding_budget_internal(p_actor_id uuid,p_characters integer)
returns boolean language plpgsql security definer set search_path=public as $$
declare accepted text; budget bigint; request_limit integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_characters not between 1 and 200000 then return false; end if;
  budget := case when p_actor_id is null then 3000000 else 600000 end;
  request_limit := case when p_actor_id is null then 1200 else 60 end;
  delete from public.embedding_request_budgets where window_start < date_trunc('hour',now())-interval '2 hours';
  insert into public.embedding_request_budgets(actor_key,window_start,requests,characters)
    values(coalesce(p_actor_id::text,'internal'),date_trunc('hour',now()),1,p_characters)
    on conflict(actor_key,window_start) do update set requests=embedding_request_budgets.requests+1,characters=embedding_request_budgets.characters+excluded.characters
      where embedding_request_budgets.requests<request_limit and embedding_request_budgets.characters+excluded.characters<=budget
    returning actor_key into accepted;
  return accepted is not null;
end;
$$;
revoke all on function public.consume_embedding_budget_internal(uuid,integer) from public,anon,authenticated;
grant execute on function public.consume_embedding_budget_internal(uuid,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-private-attachments','chat-private-attachments',false,20971520,null)
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit;
drop policy if exists "chat-private-attachments staff read" on storage.objects;
create policy "chat-private-attachments staff read" on storage.objects for select to authenticated
using(bucket_id='chat-private-attachments' and public.can_read());
drop policy if exists "chat-private-attachments staff insert" on storage.objects;
create policy "chat-private-attachments staff insert" on storage.objects for insert to authenticated
with check(bucket_id='chat-private-attachments' and public.is_staff());
drop policy if exists "chat-private-attachments staff delete" on storage.objects;
create policy "chat-private-attachments staff delete" on storage.objects for delete to authenticated
using(bucket_id='chat-private-attachments' and public.can_delete());
