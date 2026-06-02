-- Phase 4: segment-targeted campaigns. Resolve LINE-reachable customers with
-- their RFM segment + tier so staff can target a group and send one-by-one
-- (paced, human-like) — no bulk multicast.

create or replace view public.campaign_recipients
with (security_invoker = true) as
with line_conv as (
  select distinct on (customer_id) customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
)
select c.id, c.code, c.name, coalesce(c.tier, 'general') as tier,
       rf.segment, rf.recency_days, rf.frequency as total_orders, rf.monetary as total_spent,
       c.loyalty_points,
       lc.conversation_id, lc.external_id
from public.customers c
join line_conv lc on lc.customer_id = c.id
left join public.customer_rfm rf on rf.id = c.id;

grant select on public.campaign_recipients to authenticated;
