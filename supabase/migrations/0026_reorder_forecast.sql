-- Phase 4: auto-reorder forecast. Learn each customer's purchase cycle (avg days
-- between paid orders) and predict the next due date, so the reorder queue is
-- driven by real cadence instead of a fixed 45-day rule. Admin still approves
-- the send (human-in-the-loop).

create or replace view public.reorder_forecast
with (security_invoker = true) as
with paid_orders as (
  select customer_id, created_at,
         lag(created_at) over (partition by customer_id order by created_at) as prev_at
  from public.orders
  where payment_status = 'paid' and customer_id is not null
),
intervals as (
  select customer_id, extract(epoch from (created_at - prev_at)) / 86400.0 as days
  from paid_orders where prev_at is not null
),
cycle as (
  select customer_id, round(avg(days))::int as avg_cycle_days, count(*) + 1 as paid_orders
  from intervals group by customer_id
),
last_order as (
  select customer_id, max(created_at) as last_purchase_at
  from public.orders where payment_status = 'paid' and customer_id is not null
  group by customer_id
),
line_conv as (
  select distinct on (customer_id) customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
)
select c.id, c.code, c.name, coalesce(c.tier, 'general') as tier,
       cy.avg_cycle_days, cy.paid_orders, lo.last_purchase_at,
       (lo.last_purchase_at + make_interval(days => cy.avg_cycle_days)) as predicted_due_at,
       round(extract(epoch from (
         (lo.last_purchase_at + make_interval(days => cy.avg_cycle_days)) - now()
       )) / 86400.0)::int as days_until_due,
       c.last_reorder_reminder_at,
       lc.conversation_id, lc.external_id,
       usual.items as usual_items
from public.customers c
join cycle cy on cy.customer_id = c.id
join last_order lo on lo.customer_id = c.id
left join line_conv lc on lc.customer_id = c.id
left join lateral (
  select string_agg(pn, ', ') as items from (
    select oi.product_name as pn, sum(oi.quantity) as q
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.customer_id = c.id and o.payment_status = 'paid' and oi.product_name is not null
    group by oi.product_name order by q desc limit 3
  ) t
) usual on true;

grant select on public.reorder_forecast to authenticated;
