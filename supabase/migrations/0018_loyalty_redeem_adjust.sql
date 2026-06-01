-- 0018_loyalty_redeem_adjust.sql
--
-- Phase 1: close the loyalty loop. Points can now be granted/adjusted by staff
-- and redeemed for a fixed-baht discount coupon. Both are atomic (FOR UPDATE)
-- and security-definer with an is_staff() gate; they update the denormalised
-- customers.loyalty_points balance AND log a loyalty_transactions row (there is
-- no balance trigger on loyalty_transactions, so we do both).

create or replace function public.adjust_loyalty_points(
  p_customer_id uuid, p_points int, p_note text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare v_balance int;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_points = 0 then raise exception 'invalid_amount'; end if;
  select loyalty_points into v_balance from public.customers where id = p_customer_id for update;
  if v_balance is null then raise exception 'customer_not_found'; end if;
  if v_balance + p_points < 0 then raise exception 'insufficient_points'; end if;
  update public.customers set loyalty_points = loyalty_points + p_points where id = p_customer_id;
  insert into public.loyalty_transactions (customer_id, points, reason, note)
    values (p_customer_id, p_points, 'adjust', p_note);
  return v_balance + p_points;
end; $$;

create or replace function public.redeem_loyalty_points(
  p_customer_id uuid, p_points int, p_discount numeric, p_label text default null
) returns table(coupon_code text, new_balance int)
language plpgsql security definer set search_path = public as $$
declare v_balance int; v_code text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_points <= 0 or p_discount <= 0 then raise exception 'invalid_amount'; end if;
  select loyalty_points into v_balance from public.customers where id = p_customer_id for update;
  if v_balance is null then raise exception 'customer_not_found'; end if;
  if v_balance < p_points then raise exception 'insufficient_points'; end if;

  v_code := 'RDM-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  update public.customers set loyalty_points = loyalty_points - p_points where id = p_customer_id;
  insert into public.loyalty_transactions (customer_id, points, reason, note)
    values (p_customer_id, -p_points, 'redeem',
            coalesce(p_label, 'แลกแต้มเป็นส่วนลด ฿' || p_discount::text));
  insert into public.coupons (code, discount_type, discount_value, max_uses, per_customer_limit, status, valid_until, description)
    values (v_code, 'fixed', p_discount, 1, 1, 'active', now() + interval '90 days',
            'แลกจากแต้มสะสม (' || p_points::text || ' แต้ม)');

  return query select v_code, (v_balance - p_points);
end; $$;

revoke all on function public.adjust_loyalty_points(uuid, int, text) from public;
revoke all on function public.redeem_loyalty_points(uuid, int, numeric, text) from public;
grant execute on function public.adjust_loyalty_points(uuid, int, text) to authenticated;
grant execute on function public.redeem_loyalty_points(uuid, int, numeric, text) to authenticated;
