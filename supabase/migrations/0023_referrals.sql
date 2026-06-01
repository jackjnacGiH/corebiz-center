-- Phase 3: customer-to-customer referral program ("แนะนำเพื่อน").
-- Each customer has a shareable referral_code. A friend registers via a public
-- /refer/:code page (anon), creating a pending referral. Staff reward both
-- sides (referrer loyalty points + a coupon for the friend) once it converts.

-- Stable per-customer share code.
alter table public.customers add column if not exists referral_code text;
create unique index if not exists customers_referral_code_idx
  on public.customers(referral_code) where referral_code is not null;

create table if not exists public.referrals (
  id                 uuid primary key default uuid_generate_v4(),
  referrer_id        uuid not null references public.customers on delete cascade,
  referee_name       text not null,
  referee_phone      text,
  referee_customer_id uuid references public.customers on delete set null,
  status             text not null default 'pending' check (status in ('pending','rewarded','expired')),
  referrer_points    int  not null default 0,
  referrer_coupon    text,
  referee_coupon     text,
  source             text not null default 'staff' check (source in ('staff','public')),
  note               text,
  created_at         timestamptz not null default now(),
  rewarded_at        timestamptz
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id, created_at desc);
create index if not exists referrals_status_idx on public.referrals(status, created_at desc);

alter table public.referrals enable row level security;
drop policy if exists referrals_staff_all on public.referrals;
create policy referrals_staff_all on public.referrals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- anon writes only through submit_referral() below.

-- Staff: get (or lazily mint) a customer's stable share code.
create or replace function public.get_or_create_referral_code(p_customer_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select referral_code into v_code from public.customers where id = p_customer_id;
  if v_code is not null then return v_code; end if;
  loop
    v_code := upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 8));
    begin
      update public.customers set referral_code = v_code where id = p_customer_id;
      return v_code;
    exception when unique_violation then
      -- collision, try another
    end;
  end loop;
end; $$;

-- Staff: record a referral directly (e.g. a customer mentions a friend).
create or replace function public.create_referral(
  p_referrer_id uuid, p_referee_name text, p_referee_phone text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_referee_name is null or length(trim(p_referee_name)) = 0 then raise exception 'name_required'; end if;
  insert into public.referrals (referrer_id, referee_name, referee_phone, note, source)
    values (p_referrer_id, trim(p_referee_name),
            nullif(trim(coalesce(p_referee_phone, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), 'staff')
    returning id into v_id;
  return v_id;
end; $$;

-- Public (anon): a friend registers using a referrer's share code.
create or replace function public.submit_referral(
  p_code text, p_referee_name text, p_referee_phone text default null, p_note text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_referrer uuid;
begin
  if p_referee_name is null or length(trim(p_referee_name)) = 0 then raise exception 'name_required'; end if;
  select id into v_referrer from public.customers where referral_code = upper(trim(p_code));
  if v_referrer is null then raise exception 'invalid_code'; end if;
  -- de-dup: same referrer + same phone already pending -> treat as success, no row
  if nullif(trim(coalesce(p_referee_phone, '')), '') is not null and exists (
    select 1 from public.referrals
    where referrer_id = v_referrer and status = 'pending'
      and referee_phone = trim(p_referee_phone)
  ) then
    return true;
  end if;
  insert into public.referrals (referrer_id, referee_name, referee_phone, note, source)
    values (v_referrer, trim(p_referee_name),
            nullif(trim(coalesce(p_referee_phone, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), 'public');
  return true;
end; $$;

-- Staff: reward a referral — grant the referrer loyalty points (+ optional
-- coupon) and mint a coupon for the friend. Atomic + one-time.
create or replace function public.reward_referral(
  p_referral_id uuid, p_referrer_points int default 0,
  p_referee_discount int default 0, p_referrer_discount int default 0
) returns json language plpgsql security definer set search_path = public as $$
declare r public.referrals; v_referrer_coupon text; v_referee_coupon text;
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

  update public.referrals
    set status = 'rewarded', rewarded_at = now(),
        referrer_points = p_referrer_points,
        referrer_coupon = v_referrer_coupon,
        referee_coupon = v_referee_coupon
    where id = p_referral_id;

  return json_build_object('referrer_coupon', v_referrer_coupon, 'referee_coupon', v_referee_coupon);
end; $$;

-- Joined view for the CRM list.
create or replace view public.referral_overview
with (security_invoker = true) as
select r.id, r.referrer_id, r.referee_name, r.referee_phone, r.referee_customer_id,
       r.status, r.referrer_points, r.referrer_coupon, r.referee_coupon,
       r.source, r.note, r.created_at, r.rewarded_at,
       rr.name as referrer_name, rr.code as referrer_code, rr.referral_code as referrer_share_code,
       rc.name as referee_customer_name
from public.referrals r
left join public.customers rr on rr.id = r.referrer_id
left join public.customers rc on rc.id = r.referee_customer_id;

grant select on public.referral_overview to authenticated;

revoke all on function public.get_or_create_referral_code(uuid) from public;
grant execute on function public.get_or_create_referral_code(uuid) to authenticated;
revoke all on function public.create_referral(uuid, text, text, text) from public;
grant execute on function public.create_referral(uuid, text, text, text) to authenticated;
revoke all on function public.reward_referral(uuid, int, int, int) from public;
grant execute on function public.reward_referral(uuid, int, int, int) to authenticated;
revoke all on function public.submit_referral(text, text, text, text) from public;
grant execute on function public.submit_referral(text, text, text, text) to anon, authenticated;
