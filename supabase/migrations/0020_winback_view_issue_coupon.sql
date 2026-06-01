-- 0020_winback_view_issue_coupon.sql
--
-- Phase 2: win-back lapsed customers. Track when a customer was last
-- win-backed, expose a "lapsed (>=90d) + has LINE + not contacted lately" list
-- (value-prioritised), and a helper to mint a one-off discount coupon.

alter table public.customers
  add column if not exists last_winback_at timestamptz;

create or replace view public.winback_due
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
  c.last_winback_at,
  lp.last_purchase_at,
  (now()::date - lp.last_purchase_at::date) as recency_days,
  lc.conversation_id,
  lc.external_id
from public.customers c
join last_paid lp on lp.customer_id = c.id
join line_conv lc on lc.customer_id = c.id
where (now()::date - lp.last_purchase_at::date) >= 90
  and (c.last_winback_at is null or c.last_winback_at < now() - interval '60 days')
order by c.total_spent desc, recency_days desc;

grant select on public.winback_due to authenticated;

create or replace function public.issue_coupon(p_discount numeric, p_label text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_discount <= 0 then raise exception 'invalid_amount'; end if;
  v_code := 'WB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into public.coupons (code, discount_type, discount_value, max_uses, per_customer_limit, status, valid_until, description)
  values (v_code, 'fixed', p_discount, 1, 1, 'active', now() + interval '60 days',
          coalesce(p_label, 'ส่วนลด Win-back'));
  return v_code;
end; $$;

revoke all on function public.issue_coupon(numeric, text) from public;
grant execute on function public.issue_coupon(numeric, text) to authenticated;
