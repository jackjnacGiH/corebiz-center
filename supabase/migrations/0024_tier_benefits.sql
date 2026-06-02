-- Phase 4: tier privileges. A config table of per-tier benefits (loyalty
-- point multiplier + standing discount %), editable by staff, plus a
-- multiplier-aware points-earning helper.

create table if not exists public.tier_benefits (
  tier             text primary key check (tier in ('general','silver','gold','vip')),
  label            text not null,
  sort_order       int  not null default 0,
  point_multiplier numeric(4,2) not null default 1.0 check (point_multiplier >= 0),
  discount_percent numeric(5,2) not null default 0   check (discount_percent >= 0 and discount_percent <= 100),
  min_spend        numeric not null default 0,
  color            text not null default 'neutral',
  updated_at       timestamptz not null default now()
);

alter table public.tier_benefits enable row level security;
drop policy if exists tier_benefits_staff_all on public.tier_benefits;
create policy tier_benefits_staff_all on public.tier_benefits
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.tier_benefits (tier, label, sort_order, point_multiplier, discount_percent, min_spend, color) values
  ('general', 'ทั่วไป',   0, 1.00, 0, 0,       'neutral'),
  ('silver',  'เงิน',     1, 1.00, 2, 50000,   'slate'),
  ('gold',    'ทอง',      2, 1.50, 3, 200000,  'amber'),
  ('vip',     'วีไอพี',   3, 2.00, 5, 500000,  'violet')
on conflict (tier) do nothing;

-- Each customer's effective benefits (falls back to 'general' if tier null).
create or replace view public.customer_benefits
with (security_invoker = true) as
select c.id, c.name, c.code, coalesce(c.tier, 'general') as tier,
       tb.label as tier_label, tb.point_multiplier, tb.discount_percent, tb.color
from public.customers c
left join public.tier_benefits tb on tb.tier = coalesce(c.tier, 'general');

grant select on public.customer_benefits to authenticated;

-- Grant loyalty points for a purchase, applying the customer's tier multiplier.
-- Base rate: 1 point per 100 baht (floored), then x multiplier (floored).
create or replace function public.grant_purchase_points(
  p_customer_id uuid, p_amount numeric, p_note text default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_tier text; v_mult numeric; v_base int; v_pts int; v_balance int;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;
  select coalesce(tier, 'general') into v_tier from public.customers where id = p_customer_id;
  if v_tier is null then raise exception 'customer_not_found'; end if;
  select point_multiplier into v_mult from public.tier_benefits where tier = v_tier;
  v_mult := coalesce(v_mult, 1.0);
  v_base := floor(p_amount / 100.0);
  v_pts  := floor(v_base * v_mult);
  if v_pts < 0 then v_pts := 0; end if;
  v_balance := public.adjust_loyalty_points(
    p_customer_id, v_pts,
    coalesce(p_note, 'แต้มจากการซื้อ ฿' || to_char(p_amount, 'FM999,999,999') || ' (x' || v_mult || ')')
  );
  return json_build_object('points_granted', v_pts, 'multiplier', v_mult, 'new_balance', v_balance);
end; $$;

revoke all on function public.grant_purchase_points(uuid, numeric, text) from public;
grant execute on function public.grant_purchase_points(uuid, numeric, text) to authenticated;
