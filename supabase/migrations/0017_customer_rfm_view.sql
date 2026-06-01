-- 0017_customer_rfm_view.sql
--
-- RFM engine: scores every customer on Recency / Frequency / Monetary and
-- assigns a segment, so the CRM can show "who to keep, who's slipping away".
-- security_invoker => inherits the customers/orders RLS (staff-only).
--
-- Scoring uses FIXED thresholds (not relative quintiles) so it's stable and
-- interpretable even with few customers. Tune the cutoffs here as the
-- business grows. F + M reuse the maintained rollups (customers.total_orders /
-- total_spent, which already count only paid, non-cancelled/returned orders);
-- R is computed live from the last paid order date.
create or replace view public.customer_rfm
with (security_invoker = true) as
with last_paid as (
  select customer_id, max(created_at) as last_purchase_at
  from public.orders
  where customer_id is not null
    and payment_status = 'paid'
    and status not in ('cancelled', 'returned')
  group by customer_id
),
scored as (
  select
    c.id, c.code, c.name, c.contact_name, c.customer_type, c.tier,
    c.email, c.phone, c.mobile, c.tags, c.loyalty_points, c.created_at,
    lp.last_purchase_at,
    case when lp.last_purchase_at is null then null
         else (now()::date - lp.last_purchase_at::date) end as recency_days,
    coalesce(c.total_orders, 0)         as frequency,
    coalesce(c.total_spent, 0)::numeric as monetary,
    case
      when lp.last_purchase_at is null then 0
      when (now()::date - lp.last_purchase_at::date) <= 30  then 5
      when (now()::date - lp.last_purchase_at::date) <= 60  then 4
      when (now()::date - lp.last_purchase_at::date) <= 120 then 3
      when (now()::date - lp.last_purchase_at::date) <= 180 then 2
      else 1
    end as r_score,
    case
      when coalesce(c.total_orders,0) >= 20 then 5
      when coalesce(c.total_orders,0) >= 10 then 4
      when coalesce(c.total_orders,0) >= 5  then 3
      when coalesce(c.total_orders,0) >= 2  then 2
      when coalesce(c.total_orders,0) >= 1  then 1
      else 0
    end as f_score,
    case
      when coalesce(c.total_spent,0) >= 200000 then 5
      when coalesce(c.total_spent,0) >= 100000 then 4
      when coalesce(c.total_spent,0) >= 50000  then 3
      when coalesce(c.total_spent,0) >= 10000  then 2
      when coalesce(c.total_spent,0) > 0       then 1
      else 0
    end as m_score
  from public.customers c
  left join last_paid lp on lp.customer_id = c.id
)
select
  s.*,
  round((s.f_score + s.m_score) / 2.0)::int as fm_score,
  case
    when s.r_score = 0 then 'prospect'
    when s.r_score >= 4 and round((s.f_score + s.m_score)/2.0) >= 4 then 'champion'
    when s.r_score <= 2 and round((s.f_score + s.m_score)/2.0) >= 4 then 'cant_lose'
    when s.r_score >= 4 and round((s.f_score + s.m_score)/2.0) <= 2 then 'new'
    when s.r_score >= 3 and round((s.f_score + s.m_score)/2.0) >= 3 then 'loyal'
    when s.r_score <= 2 and round((s.f_score + s.m_score)/2.0) >= 3 then 'at_risk'
    when s.r_score <= 2 then 'hibernating'
    else 'needs_attention'
  end as segment
from scored s;

grant select on public.customer_rfm to authenticated;
