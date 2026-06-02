-- Phase 4: extend the referral program — link a friend to a customer record,
-- reward the friend with loyalty points (once linked), and a referrer leaderboard.

alter table public.referrals add column if not exists referee_points int not null default 0;

create or replace function public.link_referral_customer(p_referral_id uuid, p_customer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  update public.referrals set referee_customer_id = p_customer_id where id = p_referral_id;
end; $$;

drop function if exists public.reward_referral(uuid, int, int, int);
create function public.reward_referral(
  p_referral_id uuid, p_referrer_points int default 0,
  p_referee_discount int default 0, p_referrer_discount int default 0,
  p_referee_points int default 0
) returns json language plpgsql security definer set search_path = public as $$
declare r public.referrals; v_referrer_coupon text; v_referee_coupon text; v_referee_pts int := 0;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select * into r from public.referrals where id = p_referral_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = 'rewarded' then raise exception 'already_rewarded'; end if;

  if p_referrer_points > 0 then
    perform public.adjust_loyalty_points(r.referrer_id, p_referrer_points, 'รางวัลแนะนำเพื่อน');
  end if;
  if p_referrer_discount > 0 then
    v_referrer_coupon := public.issue_coupon(p_referrer_discount, 'Referral-ผู้แนะนำ');
  end if;
  if p_referee_discount > 0 then
    v_referee_coupon := public.issue_coupon(p_referee_discount, 'Referral-เพื่อนใหม่');
  end if;
  if p_referee_points > 0 and r.referee_customer_id is not null then
    perform public.adjust_loyalty_points(r.referee_customer_id, p_referee_points, 'รางวัลเพื่อนใหม่ (แนะนำเพื่อน)');
    v_referee_pts := p_referee_points;
  end if;

  update public.referrals
    set status = 'rewarded', rewarded_at = now(),
        referrer_points = p_referrer_points, referee_points = v_referee_pts,
        referrer_coupon = v_referrer_coupon, referee_coupon = v_referee_coupon
    where id = p_referral_id;

  return json_build_object('referrer_coupon', v_referrer_coupon,
                           'referee_coupon', v_referee_coupon,
                           'referee_points', v_referee_pts);
end; $$;

revoke all on function public.reward_referral(uuid, int, int, int, int) from public;
grant execute on function public.reward_referral(uuid, int, int, int, int) to authenticated;
revoke all on function public.link_referral_customer(uuid, uuid) from public;
grant execute on function public.link_referral_customer(uuid, uuid) to authenticated;

drop view if exists public.referral_overview;
create view public.referral_overview
with (security_invoker = true) as
select r.id, r.referrer_id, r.referee_name, r.referee_phone, r.referee_customer_id,
       r.status, r.referrer_points, r.referee_points, r.referrer_coupon, r.referee_coupon,
       r.source, r.note, r.created_at, r.rewarded_at,
       rr.name as referrer_name, rr.code as referrer_code, rr.referral_code as referrer_share_code,
       rc.name as referee_customer_name
from public.referrals r
left join public.customers rr on rr.id = r.referrer_id
left join public.customers rc on rc.id = r.referee_customer_id;

grant select on public.referral_overview to authenticated;

create or replace view public.referral_leaderboard
with (security_invoker = true) as
select rr.id as referrer_id, rr.name as referrer_name, rr.code as referrer_code,
       coalesce(rr.tier, 'general') as tier,
       count(*) as total_referrals,
       count(*) filter (where r.status = 'rewarded') as rewarded_count,
       count(*) filter (where r.status = 'pending') as pending_count,
       coalesce(sum(r.referrer_points) filter (where r.status = 'rewarded'), 0) as points_earned
from public.referrals r
join public.customers rr on rr.id = r.referrer_id
group by rr.id, rr.name, rr.code, rr.tier;

grant select on public.referral_leaderboard to authenticated;
