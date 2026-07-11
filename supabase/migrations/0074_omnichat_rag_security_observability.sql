-- 0074_omnichat_rag_security_observability.sql
--
-- Hardens public livechat access without interrupting the web widget:
--   * removes broad anon SELECT policies that exposed every livechat row
--   * exposes only staff/quote-link replies through a session-scoped RPC
--   * stores future customer-uploaded documents in a private bucket
-- Adds non-sensitive RAG run telemetry and embedding provenance columns.

-- ── 1. Session-scoped public livechat reads ───────────────────────────────

drop policy if exists chat_conv_livechat_anon_select on public.chat_conversations;
drop policy if exists chat_msg_livechat_anon_select on public.chat_messages;

create or replace function public.get_livechat_replies(
  p_session_id text,
  p_after timestamptz default null
)
returns table (
  id uuid,
  sender_type text,
  sender_name text,
  content text,
  created_at timestamptz,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.sender_type, m.sender_name, m.content, m.created_at, m.metadata
  from public.chat_messages m
  join public.chat_conversations c on c.id = m.conversation_id
  where c.channel = 'livechat'
    and c.external_id = left(trim(p_session_id), 160)
    and length(trim(p_session_id)) between 16 and 160
    and (p_after is null or m.created_at > p_after)
    and (
      m.sender_type = 'agent'
      or (m.sender_type = 'bot' and coalesce((m.metadata->>'quote_link')::boolean, false))
    )
  order by m.created_at asc
  limit 100;
$$;

revoke all on function public.get_livechat_replies(text, timestamptz) from public;
grant execute on function public.get_livechat_replies(text, timestamptz) to anon, authenticated;

-- ── 2. Private inbound customer documents ────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-private-files',
  'chat-private-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat-private-files staff read" on storage.objects;
create policy "chat-private-files staff read"
  on storage.objects for select to authenticated
  using (bucket_id = 'chat-private-files' and public.is_staff());

drop policy if exists "chat-private-files staff insert" on storage.objects;
create policy "chat-private-files staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-private-files' and public.is_staff());

drop policy if exists "chat-private-files staff delete" on storage.objects;
create policy "chat-private-files staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-private-files' and public.can_delete());

-- ── 3. Embedding provenance ───────────────────────────────────────────────

alter table public.knowledge_chunks
  add column if not exists embedding_model text,
  add column if not exists embedding_dimensions integer,
  add column if not exists embedding_version text,
  add column if not exists content_hash text,
  add column if not exists embedded_at timestamptz;

update public.knowledge_chunks
set embedding_model = coalesce(embedding_model, 'text-embedding-3-small'),
    embedding_dimensions = coalesce(embedding_dimensions, 1536),
    embedding_version = coalesce(embedding_version, 'openai-1536-v1'),
    embedded_at = coalesce(embedded_at, updated_at, created_at, now())
where embedding is not null
  and (embedding_model is null or embedding_dimensions is null
       or embedding_version is null or embedded_at is null);

create index if not exists knowledge_chunks_embedding_version_idx
  on public.knowledge_chunks (embedding_version)
  where embedding is not null;

-- ── 4. Privacy-safe RAG telemetry ─────────────────────────────────────────

create table if not exists public.chat_ai_runs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null default gen_random_uuid(),
  conversation_id uuid references public.chat_conversations on delete set null,
  channel text not null,
  model text,
  embedding_model text,
  embedding_version text,
  retrieval_count integer not null default 0,
  top_similarity double precision,
  tool_names text[] not null default '{}',
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  embed_ms integer not null default 0,
  search_ms integer not null default 0,
  llm_ms integer not null default 0,
  outcome text not null default 'ok',
  error_code text,
  created_at timestamptz not null default now()
);

alter table public.chat_ai_runs enable row level security;

drop policy if exists chat_ai_runs_staff_read on public.chat_ai_runs;
create policy chat_ai_runs_staff_read
  on public.chat_ai_runs for select to authenticated
  using (public.is_staff());

revoke all on public.chat_ai_runs from public, anon, authenticated;
grant select on public.chat_ai_runs to authenticated;
grant all on public.chat_ai_runs to service_role;

create index if not exists chat_ai_runs_created_idx
  on public.chat_ai_runs (created_at desc);
create index if not exists chat_ai_runs_conversation_idx
  on public.chat_ai_runs (conversation_id, created_at desc);

comment on table public.chat_ai_runs is
  'Privacy-safe chatbot telemetry. Raw prompts, responses, secrets, and personal data are intentionally not stored.';
