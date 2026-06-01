-- 0019_reorder_due_view.sql
--
-- Phase 1: reorder reminders for consumables. Track when a customer was last
-- nudged, and expose a "due for reorder" list (paid purchase long enough ago,
-- has a linked LINE chat, not reminded recently) for the CRM to act on.

alter table public.customers
  add column if not exists last_reorder_reminder_at timestamptz;

create or replace view public.reorder_due
with (security_invoker = true) as
with last_paid as (
  select customer_id, max(created_at) as last_purchase_at
  from public.orders
  where customer_id is not null
    and payment_status = 'paid'
    and status not in ('cancelled', 'returned')
  group by customer_id
),
line_conv as (
  select distinct on (customer_id)
         customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
)
select
  c.id, c.code, c.name, c.tier, c.total_orders, c.total_spent, c.loyalty_points,
  c.last_reorder_reminder_at,
  lp.last_purchase_at,
  (now()::date - lp.last_purchase_at::date) as recency_days,
  lc.conversation_id,
  lc.external_id
from public.customers c
join last_paid lp on lp.customer_id = c.id
join line_conv lc on lc.customer_id = c.id
where (now()::date - lp.last_purchase_at::date) >= 45
  and (
    c.last_reorder_reminder_at is null
    or c.last_reorder_reminder_at < lp.last_purchase_at
    or c.last_reorder_reminder_at < now() - interval '30 days'
  )
order by recency_days desc;

grant select on public.reorder_due to authenticated;
