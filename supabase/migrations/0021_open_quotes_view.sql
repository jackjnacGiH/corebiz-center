-- 0021_open_quotes_view.sql
--
-- Phase 2: "กู้ตะกร้า" for a B2B quote flow = follow up on quotes that were
-- sent but never converted to an order. Track follow-ups so we don't nag, and
-- surface the open quotes (value + age) with the linked customer / LINE chat
-- when available.

alter table public.quotes
  add column if not exists last_followup_at timestamptz;

create or replace view public.open_quotes
with (security_invoker = true) as
with line_conv as (
  select distinct on (customer_id)
         customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
)
select
  q.id, q.code, q.status, q.total, q.created_at, q.valid_until, q.last_followup_at,
  q.customer_id,
  c.name as customer_name,
  c.code as customer_code,
  (now()::date - q.created_at::date) as age_days,
  lc.conversation_id,
  lc.external_id
from public.quotes q
left join public.customers c on c.id = q.customer_id
left join line_conv lc on lc.customer_id = q.customer_id
where q.converted_to_order_id is null
  and q.status not in ('draft', 'rejected', 'cancelled', 'converted')
  and (q.last_followup_at is null or q.last_followup_at < now() - interval '7 days')
order by q.total desc, q.created_at asc;

grant select on public.open_quotes to authenticated;
