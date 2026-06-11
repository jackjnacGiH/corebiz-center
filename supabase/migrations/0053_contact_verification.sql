-- =========================================================================
-- 0053_contact_verification.sql — approval gate for tax-id account linking
-- =========================================================================
-- Boss's privacy requirement: a tax id is semi-public, so matching one must
-- NOT immediately expose the company's tier / discount / purchase history.
--
-- Flow:
--   1. Registration matches an existing customer by tax id → the contact is
--      attached UNVERIFIED. Portal shows the customer as a fresh general-tier
--      account (their own typed data, no history, no discount). Back office
--      records them under the SAME customer from day one.
--   2. An agent task (ops queue) tells staff to call and collect documents
--      (หนังสือรับรองบริษัท / ภพ.20 ฯลฯ).
--   3. Owner/Admin approves in CRM → contact becomes verified → portal
--      reveals the real tier, benefits and full history. Reject deletes the
--      link (the user can register again or contact staff).
--
-- New customers created via self-register stay auto-verified — the only data
-- shown is what they themselves typed, nothing to protect.
-- =========================================================================

alter table public.customer_contacts
  add column if not exists verified     boolean not null default false,
  add column if not exists company_name text,
  add column if not exists address      text,
  add column if not exists verified_by  uuid references public.profiles(id) on delete set null,
  add column if not exists verified_at  timestamptz;

-- Rows that exist today were linked by staff or by verified-email match.
update public.customer_contacts set verified = true where not verified;

-- Staff can read contact links (approvals happen through the RPCs below).
alter table public.customer_contacts enable row level security;
drop policy if exists customer_contacts_staff_read on public.customer_contacts;
create policy customer_contacts_staff_read on public.customer_contacts
  for select using (public.is_staff());

-- Realtime for the CRM pending panel.
do $$ begin
  alter publication supabase_realtime add table public.customer_contacts;
exception when duplicate_object then null; end $$;

-- ── Resolver: VERIFIED links only (gates my_orders / my_quotes / items) ─────
create or replace function public.my_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select customer_id from public.customer_contacts
      where user_id = auth.uid() and verified limit 1),
    (select id from public.customers where user_id = auth.uid() limit 1)
  );
$$;

-- Email auto-link: login proves ownership of the e-mail already on file → trusted.
create or replace function public.link_my_customer_by_email()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_email text; v_id uuid; v_cnt int;
begin
  if auth.uid() is null then return null; end if;
  v_id := public.my_customer_id();
  if v_id is not null then return v_id; end if;

  select lower(trim(u.email)) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or v_email = '' then return null; end if;

  select count(*) into v_cnt
  from public.customers c
  where lower(trim(c.email)) = v_email and c.user_id is null;
  if v_cnt <> 1 then return null; end if;

  update public.customers c
     set user_id = auth.uid()
   where lower(trim(c.email)) = v_email and c.user_id is null
  returning c.id into v_id;

  if v_id is not null then
    insert into public.customer_contacts (customer_id, user_id, verified)
    values (v_id, auth.uid(), true)
    on conflict (user_id) do nothing;
  end if;
  return v_id;
end;
$$;

-- ── Registration: tax-id match now goes through the approval gate ───────────
create or replace function public.register_my_customer(
  p_contact_name text,
  p_tax_id       text,
  p_phone        text,
  p_address      text,
  p_company_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text;
  v_tax     text;
  v_cust_id uuid;
  v_matched boolean := false;
  v_addr    jsonb;
  v_name    text;
  v_code    text;
  v_cust_name text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  v_cust_id := public.my_customer_id();
  if v_cust_id is not null then return v_cust_id; end if;
  -- A pending (unverified) request also blocks re-registration.
  if exists (select 1 from public.customer_contacts where user_id = v_uid) then
    select customer_id into v_cust_id from public.customer_contacts where user_id = v_uid;
    return v_cust_id;
  end if;

  p_contact_name := nullif(trim(p_contact_name), '');
  if p_contact_name is null then raise exception 'contact_name_required'; end if;

  v_tax := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  if length(v_tax) <> 13 then raise exception 'tax_id_invalid'; end if;

  p_phone        := nullif(trim(p_phone), '');
  p_address      := nullif(trim(p_address), '');
  p_company_name := nullif(trim(p_company_name), '');

  select lower(trim(email)) into v_email from auth.users where id = v_uid;

  select id, name into v_cust_id, v_cust_name
  from public.customers
  where regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g') = v_tax
  order by created_at
  limit 1;

  if v_cust_id is not null then
    -- EXISTING customer: attach UNVERIFIED — no CRM data is revealed until
    -- Owner/Admin approves. The customer row itself is not touched.
    v_matched := true;
    insert into public.customer_contacts
      (customer_id, user_id, contact_name, phone, company_name, address, verified)
    values (v_cust_id, v_uid, p_contact_name, p_phone, p_company_name, p_address, false);

    -- Ops queue: tell staff to collect verification documents.
    insert into public.agent_tasks
      (category, kind, action_kind, title, summary, recommendation,
       payload, status, requires_approval, priority, related_type, related_id,
       dedupe_key, source)
    values
      ('ops', 'ops.verify_customer_link', 'none',
       'ยืนยันการเชื่อมบัญชีลูกค้า: ' || p_contact_name,
       'ลงทะเบียนจากหน้าร้านด้วยเลขผู้เสียภาษีที่ตรงกับลูกค้า "' || coalesce(v_cust_name, '-') ||
         '" — ติดต่อขอเอกสารยืนยัน (เช่น หนังสือรับรองบริษัท, ภพ.20) ก่อนเปิดให้เห็นข้อมูล Tier และประวัติ',
       'โทร ' || coalesce(p_phone, '-') || ' / อีเมล ' || coalesce(v_email, '-') ||
         ' แล้วให้ Owner หรือ Admin กดอนุมัติในหน้า ระบบลูกค้า (CRM)',
       jsonb_build_object('contact_name', p_contact_name, 'phone', p_phone,
                          'email', v_email, 'tax_id', v_tax,
                          'customer_name', v_cust_name),
       'proposed', true, 1, 'customer', v_cust_id::text,
       'verify_link:' || v_uid::text, 'portal')
    on conflict (dedupe_key) do nothing;
  else
    -- NEW customer: nothing sensitive to reveal → verified immediately.
    v_addr := jsonb_build_object('address', p_address);
    v_name := coalesce(p_company_name, p_contact_name);
    select case when exists (select 1 from public.customers where code = v_tax)
                then null else v_tax end into v_code;
    insert into public.customers (code, name, customer_type, tier, email, phone, tax_id,
                                  billing_address, shipping_address, source_channel)
    values (v_code, v_name, 'company', 'general', v_email, p_phone, v_tax,
            v_addr, v_addr, 'self_register')
    returning id into v_cust_id;

    insert into public.customer_contacts
      (customer_id, user_id, contact_name, phone, company_name, address, verified)
    values (v_cust_id, v_uid, p_contact_name, p_phone, p_company_name, p_address, true);
  end if;

  update public.profiles
     set full_name = p_contact_name,
         phone = coalesce(p_phone, phone),
         updated_at = now()
   where id = v_uid;

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (v_uid,
          case when v_matched then 'customer.self_link_pending' else 'customer.self_register' end,
          'customer', v_cust_id::text,
          jsonb_build_object('contact_name', p_contact_name, 'tax_id', v_tax,
                             'email', v_email, 'matched_existing', v_matched));

  return v_cust_id;
end;
$$;

-- ── Profile: verified → real data; pending → masked general-tier profile ────
drop function if exists public.my_customer_profile();
create or replace function public.my_customer_profile()
returns table (
  customer_id uuid, code text, name text, customer_type text,
  email text, phone text, tax_id text,
  billing_address jsonb, shipping_address jsonb,
  tier text, tier_label text, discount_percent numeric, point_multiplier numeric,
  loyalty_points int, total_spent numeric, total_orders int,
  contact_name text, contact_phone text,
  pending_verification boolean
) language sql stable security definer set search_path = public as $$
  -- Verified link → the real customer.
  select c.id, c.code, c.name, c.customer_type,
         c.email, c.phone, c.tax_id,
         c.billing_address, c.shipping_address,
         c.tier, tb.label, tb.discount_percent, tb.point_multiplier,
         c.loyalty_points, c.total_spent, c.total_orders,
         cc.contact_name, cc.phone,
         false
  from public.customers c
  join public.tier_benefits tb on tb.tier = c.tier
  left join public.customer_contacts cc
         on cc.customer_id = c.id and cc.user_id = auth.uid()
  where c.id = public.my_customer_id()

  union all

  -- Pending link → only what the customer typed themselves + general tier.
  -- CRM name / tier / history stay hidden until Owner/Admin approves.
  select cc.customer_id,
         regexp_replace(coalesce(c2.tax_id, ''), '[^0-9]', '', 'g'),
         coalesce(cc.company_name, cc.contact_name),
         'company',
         u.email, cc.phone,
         regexp_replace(coalesce(c2.tax_id, ''), '[^0-9]', '', 'g'),
         jsonb_build_object('address', cc.address),
         jsonb_build_object('address', cc.address),
         'general', tbg.label, 0, 1,
         0, 0, 0,
         cc.contact_name, cc.phone,
         true
  from public.customer_contacts cc
  join public.customers c2 on c2.id = cc.customer_id
  join auth.users u on u.id = cc.user_id
  join public.tier_benefits tbg on tbg.tier = 'general'
  where cc.user_id = auth.uid()
    and not cc.verified
    and public.my_customer_id() is null
  limit 1;
$$;

-- ── Staff: pending list + approve / reject (Owner & Admin only) ─────────────
create or replace function public.list_pending_customer_links()
returns table (contact_id uuid, requested_at timestamptz,
               contact_name text, contact_phone text, login_email text,
               claimed_company text, claimed_address text,
               customer_id uuid, customer_code text, customer_name text, customer_tier text)
language sql stable security definer set search_path = public as $$
  select cc.id, cc.created_at, cc.contact_name, cc.phone, u.email,
         cc.company_name, cc.address,
         c.id, c.code, c.name, c.tier
  from public.customer_contacts cc
  join public.customers c on c.id = cc.customer_id
  join auth.users u on u.id = cc.user_id
  where not cc.verified and public.is_staff()
  order by cc.created_at;
$$;

create or replace function public.approve_customer_link(p_contact_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_user uuid; v_cust uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and is_active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'forbidden: owner/admin only';
  end if;

  update public.customer_contacts
     set verified = true, verified_by = auth.uid(), verified_at = now()
   where id = p_contact_id and not verified
  returning user_id, customer_id into v_user, v_cust;
  if v_user is null then raise exception 'not_found'; end if;

  update public.agent_tasks
     set status = 'executed', executed_at = now()
   where dedupe_key = 'verify_link:' || v_user::text
     and status in ('proposed','approved');

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (auth.uid(), 'customer.link_approved', 'customer', v_cust::text,
          jsonb_build_object('contact_id', p_contact_id, 'user_id', v_user));
end;
$$;

create or replace function public.reject_customer_link(p_contact_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_user uuid; v_cust uuid;
begin
  select role into v_role from public.profiles where id = auth.uid() and is_active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'forbidden: owner/admin only';
  end if;

  delete from public.customer_contacts
   where id = p_contact_id and not verified
  returning user_id, customer_id into v_user, v_cust;
  if v_user is null then raise exception 'not_found'; end if;

  update public.agent_tasks
     set status = 'dismissed'
   where dedupe_key = 'verify_link:' || v_user::text
     and status in ('proposed','approved');

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (auth.uid(), 'customer.link_rejected', 'customer', v_cust::text,
          jsonb_build_object('contact_id', p_contact_id, 'user_id', v_user));
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public.my_customer_profile() from public, anon;
revoke execute on function public.list_pending_customer_links() from public, anon;
revoke execute on function public.approve_customer_link(uuid) from public, anon;
revoke execute on function public.reject_customer_link(uuid) from public, anon;
grant execute on function public.my_customer_profile() to authenticated;
grant execute on function public.list_pending_customer_links() to authenticated;
grant execute on function public.approve_customer_link(uuid) to authenticated;
grant execute on function public.reject_customer_link(uuid) to authenticated;
