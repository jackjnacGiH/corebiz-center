-- =========================================================================
-- 0051_customer_self_register.sql — customer self-registration + multi-contact
-- =========================================================================
-- A logged-in user whose e-mail doesn't match any CRM customer can register
-- their company themselves from "บัญชีของฉัน":
--   contact name + phone + 13-digit tax id + address (company name optional).
--
-- On submit (register_my_customer):
--   • Tax id (13 digits) is matched against existing customers.
--   • MATCH  → attach this login as a CONTACT of that customer; the customer
--              keeps its CRM tier, purchase history, address & phone (system
--              data is authoritative). Only the contact NAME is per-login.
--   • NO MATCH → create a new customer (tier 'general', source 'self_register')
--                from the form data.
--
-- One company can have MANY login contacts (different people), so contacts are
-- stored in a junction table customer_contacts (not customers.user_id, which is
-- 1:1). my_customer_id() now resolves through it (with a legacy fallback).
-- =========================================================================

-- ── Junction: multiple login contacts per CRM customer ──────────────────────
create table if not exists public.customer_contacts (
  id           uuid primary key default uuid_generate_v4(),
  customer_id  uuid not null references public.customers on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  contact_name text,
  phone        text,
  created_at   timestamptz not null default now(),
  unique (user_id)          -- one auth user belongs to exactly one customer
);
create index if not exists customer_contacts_customer_idx on public.customer_contacts(customer_id);

-- Backfill existing 1:1 links so the new resolver sees them.
insert into public.customer_contacts (customer_id, user_id)
select id, user_id from public.customers where user_id is not null
on conflict (user_id) do nothing;

-- ── Resolver: this user's customer (junction first, legacy column fallback) ──
create or replace function public.my_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select customer_id from public.customer_contacts where user_id = auth.uid() limit 1),
    (select id from public.customers where user_id = auth.uid() limit 1)
  );
$$;

-- ── Email auto-link now also records a contact row ──────────────────────────
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
    insert into public.customer_contacts (customer_id, user_id)
    values (v_id, auth.uid())
    on conflict (user_id) do nothing;
  end if;
  return v_id;
end;
$$;

-- ── Self-registration / tax-id linking ──────────────────────────────────────
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
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- Already linked → return existing (idempotent).
  v_cust_id := public.my_customer_id();
  if v_cust_id is not null then return v_cust_id; end if;

  p_contact_name := nullif(trim(p_contact_name), '');
  if p_contact_name is null then raise exception 'contact_name_required'; end if;

  v_tax := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  if length(v_tax) <> 13 then raise exception 'tax_id_invalid'; end if;

  p_phone        := nullif(trim(p_phone), '');
  p_address      := nullif(trim(p_address), '');
  p_company_name := nullif(trim(p_company_name), '');

  select lower(trim(email)) into v_email from auth.users where id = v_uid;

  -- Match an existing customer by tax id (digits only).
  select id into v_cust_id
  from public.customers
  where regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g') = v_tax
  order by created_at
  limit 1;

  if v_cust_id is not null then
    -- EXISTING: keep CRM tier / history / address / phone (authoritative).
    v_matched := true;
    update public.customers set email = coalesce(email, v_email), updated_at = now()
     where id = v_cust_id;
  else
    -- NEW: create from form data, general tier.
    v_addr  := jsonb_build_object('address', p_address);
    v_name  := coalesce(p_company_name, p_contact_name);
    insert into public.customers (name, customer_type, tier, email, phone, tax_id,
                                  billing_address, shipping_address, source_channel)
    values (v_name, 'company', 'general', v_email, p_phone, v_tax,
            v_addr, v_addr, 'self_register')
    returning id into v_cust_id;
  end if;

  -- Attach this login as a contact (the person — per-login name).
  insert into public.customer_contacts (customer_id, user_id, contact_name, phone)
  values (v_cust_id, v_uid, p_contact_name, p_phone)
  on conflict (user_id) do update
    set customer_id = excluded.customer_id,
        contact_name = excluded.contact_name,
        phone = excluded.phone;

  update public.profiles
     set full_name = p_contact_name,
         phone = coalesce(p_phone, phone),
         updated_at = now()
   where id = v_uid;

  -- Audit trail for staff (visible in CRM activity / audit log).
  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (v_uid,
          case when v_matched then 'customer.self_link' else 'customer.self_register' end,
          'customer', v_cust_id::text,
          jsonb_build_object('contact_name', p_contact_name, 'tax_id', v_tax,
                             'email', v_email, 'matched_existing', v_matched));

  return v_cust_id;
end;
$$;

-- ── Profile RPC: add the per-login contact name ─────────────────────────────
drop function if exists public.my_customer_profile();
create or replace function public.my_customer_profile()
returns table (
  customer_id uuid, code text, name text, customer_type text,
  email text, phone text, tax_id text,
  billing_address jsonb, shipping_address jsonb,
  tier text, tier_label text, discount_percent numeric, point_multiplier numeric,
  loyalty_points int, total_spent numeric, total_orders int,
  contact_name text
) language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.name, c.customer_type,
         c.email, c.phone, c.tax_id,
         c.billing_address, c.shipping_address,
         c.tier, tb.label, tb.discount_percent, tb.point_multiplier,
         c.loyalty_points, c.total_spent, c.total_orders,
         cc.contact_name
  from public.customers c
  join public.tier_benefits tb on tb.tier = c.tier
  left join public.customer_contacts cc
         on cc.customer_id = c.id and cc.user_id = auth.uid()
  where c.id = public.my_customer_id()
  limit 1;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public.register_my_customer(text, text, text, text, text) from public, anon;
revoke execute on function public.my_customer_profile() from public, anon;
grant execute on function public.register_my_customer(text, text, text, text, text) to authenticated;
grant execute on function public.my_customer_profile() to authenticated;
