-- Phase 3: satisfaction surveys (NPS). Sent over LINE as a link; answered on a
-- public page (no login) which records the score by token via an anon RPC.

create table if not exists public.surveys (
  id              uuid primary key default uuid_generate_v4(),
  customer_id     uuid references public.customers on delete set null,
  order_id        uuid references public.orders on delete set null,
  conversation_id uuid references public.chat_conversations on delete set null,
  token           uuid not null unique default uuid_generate_v4(),
  type            text not null default 'nps' check (type in ('nps','csat')),
  score           int check (score between 0 and 10),
  comment         text,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz
);
create index if not exists surveys_customer_idx on public.surveys(customer_id, created_at desc);
create index if not exists surveys_answered_idx on public.surveys(answered_at desc nulls last);

alter table public.surveys enable row level security;
drop policy if exists surveys_staff_all on public.surveys;
create policy surveys_staff_all on public.surveys
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- No direct anon table policy; anon answers only via submit_survey() below.

-- Staff: create a survey row and return its token (to build the public link).
create or replace function public.create_survey(
  p_customer_id uuid, p_conversation_id uuid default null, p_order_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  insert into public.surveys (customer_id, conversation_id, order_id)
    values (p_customer_id, p_conversation_id, p_order_id)
    returning token into v_token;
  return v_token;
end; $$;

-- Public (anon): record a survey answer by its token, one time only.
create or replace function public.submit_survey(
  p_token uuid, p_score int, p_comment text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_score is null or p_score < 0 or p_score > 10 then raise exception 'invalid_score'; end if;
  update public.surveys
    set score = p_score,
        comment = nullif(trim(coalesce(p_comment, '')), ''),
        answered_at = now()
    where token = p_token and answered_at is null
    returning id into v_id;
  return v_id is not null;
end; $$;

-- Survey targets: real customers (>=1 paid order) with a LINE chat, not
-- surveyed in the last 90 days.
create or replace view public.survey_due
with (security_invoker = true) as
with paid as (
  select distinct customer_id from public.orders
  where customer_id is not null and payment_status = 'paid'
),
line_conv as (
  select distinct on (customer_id) customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
),
recent_survey as (
  select customer_id, max(created_at) as last_survey_at
  from public.surveys where customer_id is not null group by customer_id
)
select c.id, c.code, c.name, c.tier, c.total_orders, c.total_spent,
       lc.conversation_id, lc.external_id, rs.last_survey_at
from public.customers c
join paid p on p.customer_id = c.id
join line_conv lc on lc.customer_id = c.id
left join recent_survey rs on rs.customer_id = c.id
where rs.last_survey_at is null or rs.last_survey_at < now() - interval '90 days'
order by c.total_spent desc;

grant select on public.survey_due to authenticated;

revoke all on function public.create_survey(uuid, uuid, uuid) from public;
grant execute on function public.create_survey(uuid, uuid, uuid) to authenticated;
revoke all on function public.submit_survey(uuid, int, text) from public;
grant execute on function public.submit_survey(uuid, int, text) to anon, authenticated;
