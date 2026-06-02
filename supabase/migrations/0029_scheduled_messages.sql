-- Phase 5: scheduled sends. Staff queue a LINE message for a future time; when
-- it's due the admin confirms the send (human-in-the-loop, no unattended cron).

create table if not exists public.scheduled_messages (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers on delete cascade,
  conversation_id uuid not null references public.chat_conversations on delete cascade,
  kind            text not null default 'custom' check (kind in ('custom','campaign','reorder','promo')),
  text            text not null,
  scheduled_at    timestamptz not null,
  status          text not null default 'pending' check (status in ('pending','sent','cancelled')),
  note            text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages(status, scheduled_at);

alter table public.scheduled_messages enable row level security;
drop policy if exists scheduled_messages_staff_all on public.scheduled_messages;
create policy scheduled_messages_staff_all on public.scheduled_messages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace view public.scheduled_overview
with (security_invoker = true) as
select s.id, s.customer_id, s.conversation_id, s.kind, s.text, s.scheduled_at,
       s.status, s.note, s.created_at, s.sent_at,
       c.name as customer_name, c.code as customer_code,
       (s.status = 'pending' and s.scheduled_at <= now()) as is_due
from public.scheduled_messages s
left join public.customers c on c.id = s.customer_id;

grant select on public.scheduled_overview to authenticated;
