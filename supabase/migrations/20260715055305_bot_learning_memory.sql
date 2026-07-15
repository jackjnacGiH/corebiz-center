-- 0077 / 20260715055305 — Safe bot learning loop
--
-- This migration deliberately separates conversational continuity from
-- organisational learning. Neither table accepts anonymous access, and no
-- candidate becomes RAG knowledge without an explicit staff approval plus
-- approved guidance. Product, payment, PO, and privacy guardrails remain in
-- rag-chat and are never represented as editable learning data.

create table if not exists public.bot_learning_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  context_memory_enabled boolean not null default true,
  candidate_capture_enabled boolean not null default true,
  memory_ttl_days integer not null default 90 check (memory_ttl_days between 7 and 365),
  max_context_chars integer not null default 600 check (max_context_chars between 160 and 1200),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

insert into public.bot_learning_settings (id)
values (true)
on conflict (id) do nothing;

-- A deliberately small, redacted continuity note per conversation. It is
-- written by the server only, expires automatically, and never stores a raw
-- transcript, payment/PO details, contacts, addresses, or attachments.
create table if not exists public.bot_conversation_memory (
  conversation_id uuid primary key references public.chat_conversations(id) on delete cascade,
  summary text not null check (char_length(summary) between 1 and 600),
  topics text[] not null default '{}',
  source_channel text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(topics) <= 8)
);

-- Learning candidates are redacted, bounded signals only. They are a review
-- queue, not a self-training corpus. Approved guidance is injected only when
-- staff adds clear trigger terms and explicitly approves the entry.
create table if not exists public.bot_learning_candidates (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  candidate_kind text not null check (candidate_kind in (
    'knowledge_gap', 'follow_up_needed', 'repeat_question', 'product_alias'
  )),
  fingerprint text not null check (char_length(fingerprint) between 8 and 128),
  sample_text text not null check (char_length(sample_text) between 1 and 500),
  trigger_terms text[] not null default '{}',
  occurrence_count integer not null default 1 check (occurrence_count >= 1),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  approved_guidance text check (approved_guidance is null or char_length(approved_guidance) between 1 and 1200),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_kind, fingerprint),
  check (cardinality(trigger_terms) <= 8),
  check (
    status <> 'approved'
    or (
      approved_guidance is not null
      and char_length(trim(approved_guidance)) > 0
      and cardinality(trigger_terms) > 0
    )
  )
);

create index if not exists bot_conversation_memory_expiry_idx
  on public.bot_conversation_memory (expires_at);
create index if not exists bot_learning_candidates_queue_idx
  on public.bot_learning_candidates (status, risk_level, last_seen_at desc);
create index if not exists bot_learning_candidates_conversation_idx
  on public.bot_learning_candidates (conversation_id, last_seen_at desc)
  where conversation_id is not null;

alter table public.bot_learning_settings enable row level security;
alter table public.bot_conversation_memory enable row level security;
alter table public.bot_learning_candidates enable row level security;

drop policy if exists bot_learning_settings_staff_all on public.bot_learning_settings;
create policy bot_learning_settings_staff_all
  on public.bot_learning_settings for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists bot_conversation_memory_staff_all on public.bot_conversation_memory;
create policy bot_conversation_memory_staff_all
  on public.bot_conversation_memory for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists bot_learning_candidates_staff_all on public.bot_learning_candidates;
create policy bot_learning_candidates_staff_all
  on public.bot_learning_candidates for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

revoke all on table public.bot_learning_settings from public, anon, authenticated;
revoke all on table public.bot_conversation_memory from public, anon, authenticated;
revoke all on table public.bot_learning_candidates from public, anon, authenticated;

grant select, update on table public.bot_learning_settings to authenticated;
grant select, insert, update on table public.bot_conversation_memory to authenticated;
grant select, insert, update on table public.bot_learning_candidates to authenticated;
grant all on table public.bot_learning_settings to service_role;
grant all on table public.bot_conversation_memory to service_role;
grant all on table public.bot_learning_candidates to service_role;

comment on table public.bot_learning_settings is
  'Staff-only controls for the safe bot learning loop. Defaults favour continuity and review, never autonomous fact publishing.';
comment on table public.bot_conversation_memory is
  'Short-lived redacted conversation continuity notes. Never a raw chat transcript or a cross-customer profile.';
comment on table public.bot_learning_candidates is
  'Staff-only redacted learning review queue. A candidate affects replies only after explicit approval with safe guidance.';
