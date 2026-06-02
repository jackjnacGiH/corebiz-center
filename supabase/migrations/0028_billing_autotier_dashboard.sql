-- Phase 5: (a) auto-grant tier-multiplied loyalty points when an order is paid,
-- (b) auto-tier suggestions from total_spent, (c) a CRM dashboard stats RPC.

-- (a) Order paid → grant points = floor(total/100) * tier multiplier. Runs as
-- definer with NO is_staff gate (a trigger must not depend on auth context, or
-- it would break order updates done by service role). Idempotent per order.
create or replace function public.tg_order_paid_grant_points()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tier text; v_mult numeric; v_pts int;
begin
  if NEW.customer_id is null then return NEW; end if;
  if NEW.payment_status is distinct from 'paid' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.payment_status = 'paid' then return NEW; end if;
  if coalesce(NEW.total, 0) <= 0 then return NEW; end if;
  if exists (select 1 from public.loyalty_transactions
             where reference_type = 'order' and reference_id = NEW.id and reason = 'earn_order') then
    return NEW;
  end if;
  select coalesce(tier, 'general') into v_tier from public.customers where id = NEW.customer_id;
  if v_tier is null then return NEW; end if;
  select coalesce(point_multiplier, 1.0) into v_mult from public.tier_benefits where tier = v_tier;
  v_mult := coalesce(v_mult, 1.0);
  v_pts := floor(floor(NEW.total / 100.0) * v_mult);
  if v_pts <= 0 then return NEW; end if;
  update public.customers set loyalty_points = loyalty_points + v_pts where id = NEW.customer_id;
  insert into public.loyalty_transactions (customer_id, points, reason, note, reference_type, reference_id)
    values (NEW.customer_id, v_pts, 'earn_order',
            'แต้มจากออเดอร์ ' || coalesce(NEW.code, '') || ' (x' || v_mult || ')', 'order', NEW.id);
  return NEW;
end; $$;

drop trigger if exists order_paid_grant_points on public.orders;
create trigger order_paid_grant_points
  after insert or update of payment_status on public.orders
  for each row execute function public.tg_order_paid_grant_points();

-- (b) Auto-tier from lifetime spend, using tier_benefits.min_spend thresholds.
create or replace function public.suggest_tier(p_spent numeric)
returns text language sql stable set search_path = public as $$
  select tier from public.tier_benefits
  where min_spend <= coalesce(p_spent, 0)
  order by min_spend desc limit 1;
$$;

create or replace view public.tier_suggestions
with (security_invoker = true) as
with lc as (
  select distinct on (customer_id) customer_id, id as conversation_id, external_id
  from public.chat_conversations
  where channel = 'line' and customer_id is not null and external_id is not null
  order by customer_id, last_message_at desc nulls last
)
select c.id, c.code, c.name, coalesce(c.tier, 'general') as current_tier,
       public.suggest_tier(c.total_spent) as suggested_tier,
       c.total_spent, c.total_orders, c.loyalty_points,
       lc.conversation_id, lc.external_id
from public.customers c
left join lc on lc.customer_id = c.id
where public.suggest_tier(c.total_spent) is distinct from coalesce(c.tier, 'general');

grant select on public.tier_suggestions to authenticated;

create or replace function public.apply_customer_tier(p_customer_id uuid, p_tier text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_tier not in ('general','silver','gold','vip') then raise exception 'invalid_tier'; end if;
  update public.customers set tier = p_tier where id = p_customer_id;
end; $$;

revoke all on function public.apply_customer_tier(uuid, text) from public;
grant execute on function public.apply_customer_tier(uuid, text) to authenticated;

-- (c) One-call CRM dashboard snapshot.
create or replace function public.crm_dashboard_stats()
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select json_build_object(
    'customers', (select json_build_object(
        'total', count(*),
        'with_line', count(*) filter (where exists (select 1 from public.chat_conversations cc where cc.customer_id = c.id and cc.channel = 'line')),
        'general', count(*) filter (where coalesce(tier,'general') = 'general'),
        'silver', count(*) filter (where tier = 'silver'),
        'gold', count(*) filter (where tier = 'gold'),
        'vip', count(*) filter (where tier = 'vip')
      ) from public.customers c),
    'orders', (select json_build_object(
        'paid_orders', count(*) filter (where payment_status = 'paid'),
        'revenue', coalesce(sum(total) filter (where payment_status = 'paid'), 0)
      ) from public.orders),
    'repeat', (select json_build_object(
        'buyers', count(*),
        'repeat_buyers', count(*) filter (where cnt >= 2),
        'rate', case when count(*) > 0 then round(100.0 * count(*) filter (where cnt >= 2) / count(*)) else 0 end
      ) from (select customer_id, count(*) cnt from public.orders where payment_status = 'paid' and customer_id is not null group by customer_id) t),
    'nps', (select json_build_object(
        'responses', count(*) filter (where score is not null),
        'promoters', count(*) filter (where score >= 9),
        'passives', count(*) filter (where score between 7 and 8),
        'detractors', count(*) filter (where score is not null and score <= 6),
        'score', case when count(*) filter (where score is not null) > 0
            then round(100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score is not null and score <= 6)) / count(*) filter (where score is not null))
            else null end
      ) from public.surveys),
    'loyalty', (select json_build_object('points_outstanding', coalesce(sum(loyalty_points), 0)) from public.customers),
    'coupons', (select json_build_object('active', count(*) filter (where status = 'active')) from public.coupons),
    'referrals', (select json_build_object(
        'total', count(*),
        'rewarded', count(*) filter (where status = 'rewarded'),
        'pending', count(*) filter (where status = 'pending')
      ) from public.referrals),
    'segments', (select coalesce(json_agg(json_build_object('segment', segment, 'count', cnt, 'value', val) order by val desc), '[]'::json)
        from (select segment, count(*) cnt, coalesce(sum(monetary), 0) val from public.customer_rfm group by segment) s)
  ) into result;
  return result;
end; $$;

revoke all on function public.crm_dashboard_stats() from public;
grant execute on function public.crm_dashboard_stats() to authenticated;
