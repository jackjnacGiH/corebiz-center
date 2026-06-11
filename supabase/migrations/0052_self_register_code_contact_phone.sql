-- =========================================================================
-- 0052_self_register_code_contact_phone.sql — Boss's refinements
-- =========================================================================
-- 1. New self-registered customers use the 13-digit tax id as their customer
--    CODE (when free) — "ใช้เลขผู้เสียภาษี 13 หลักเป็นรหัสลูกค้า".
-- 2. The contact's MOBILE phone is per-login (like the contact name): kept as
--    typed in customer_contacts and exposed via my_customer_profile() as
--    contact_phone. The customer row's phone stays CRM-authoritative.
-- =========================================================================

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
    -- NEW: create from form data, general tier; tax id doubles as the
    -- customer code when that code is still free.
    v_addr := jsonb_build_object('address', p_address);
    v_name := coalesce(p_company_name, p_contact_name);
    select case when exists (select 1 from public.customers where code = v_tax)
                then null else v_tax end into v_code;
    insert into public.customers (code, name, customer_type, tier, email, phone, tax_id,
                                  billing_address, shipping_address, source_channel)
    values (v_code, v_name, 'company', 'general', v_email, p_phone, v_tax,
            v_addr, v_addr, 'self_register')
    returning id into v_cust_id;
  end if;

  -- Attach this login as a contact — name AND mobile are per-login
  -- (one company, many contact people).
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

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (v_uid,
          case when v_matched then 'customer.self_link' else 'customer.self_register' end,
          'customer', v_cust_id::text,
          jsonb_build_object('contact_name', p_contact_name, 'tax_id', v_tax,
                             'email', v_email, 'matched_existing', v_matched));

  return v_cust_id;
end;
$$;

-- Profile RPC: expose the per-login contact phone too.
drop function if exists public.my_customer_profile();
create or replace function public.my_customer_profile()
returns table (
  customer_id uuid, code text, name text, customer_type text,
  email text, phone text, tax_id text,
  billing_address jsonb, shipping_address jsonb,
  tier text, tier_label text, discount_percent numeric, point_multiplier numeric,
  loyalty_points int, total_spent numeric, total_orders int,
  contact_name text, contact_phone text
) language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.name, c.customer_type,
         c.email, c.phone, c.tax_id,
         c.billing_address, c.shipping_address,
         c.tier, tb.label, tb.discount_percent, tb.point_multiplier,
         c.loyalty_points, c.total_spent, c.total_orders,
         cc.contact_name, cc.phone
  from public.customers c
  join public.tier_benefits tb on tb.tier = c.tier
  left join public.customer_contacts cc
         on cc.customer_id = c.id and cc.user_id = auth.uid()
  where c.id = public.my_customer_id()
  limit 1;
$$;

revoke execute on function public.my_customer_profile() from public, anon;
grant execute on function public.my_customer_profile() to authenticated;
