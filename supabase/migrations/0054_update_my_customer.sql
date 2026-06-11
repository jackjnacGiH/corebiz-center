-- =========================================================================
-- 0054_update_my_customer.sql — portal: customers edit their own info
-- =========================================================================
-- "บัญชีของฉัน" gets an edit form (typos in names, phones, addresses).
--
-- Rules:
--   • Contact name + mobile are per-login (customer_contacts + profiles).
--   • Company name / phone / billing / shipping update the CRM customer row
--     ONLY for a VERIFIED link. A pending (unverified) contact edits just its
--     own claimed data on the contact row — the real customer is untouched.
--   • tax_id is NEVER editable from the portal (it is the link key — staff
--     only). Email comes from the login and is not editable here either.
--   • Every edit is audit-logged for staff review.
-- =========================================================================

create or replace function public.update_my_customer(
  p_contact_name     text,
  p_contact_phone    text,
  p_company_name     text default null,
  p_company_phone    text default null,
  p_billing_address  text default null,
  p_shipping_address text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_cust_id  uuid;
  v_verified boolean;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select customer_id, verified into v_cust_id, v_verified
  from public.customer_contacts where user_id = v_uid;
  if v_cust_id is null then
    -- legacy 1:1 link without a contact row
    select id, true into v_cust_id, v_verified from public.customers where user_id = v_uid;
    if v_cust_id is null then raise exception 'not_linked'; end if;
    insert into public.customer_contacts (customer_id, user_id, verified)
    values (v_cust_id, v_uid, true)
    on conflict (user_id) do nothing;
  end if;

  p_contact_name     := nullif(trim(p_contact_name), '');
  if p_contact_name is null then raise exception 'contact_name_required'; end if;
  p_contact_phone    := nullif(trim(p_contact_phone), '');
  p_company_name     := nullif(trim(p_company_name), '');
  p_company_phone    := nullif(trim(p_company_phone), '');
  p_billing_address  := nullif(trim(p_billing_address), '');
  p_shipping_address := nullif(trim(p_shipping_address), '');

  update public.customer_contacts
     set contact_name = p_contact_name,
         phone        = p_contact_phone,
         company_name = coalesce(p_company_name, company_name),
         address      = coalesce(p_billing_address, address)
   where user_id = v_uid;

  update public.profiles
     set full_name = p_contact_name,
         phone     = coalesce(p_contact_phone, phone),
         updated_at = now()
   where id = v_uid;

  if v_verified then
    update public.customers
       set name  = coalesce(p_company_name, name),
           phone = coalesce(p_company_phone, phone),
           billing_address  = case when p_billing_address is not null
                                   then jsonb_build_object('address', p_billing_address)
                                   else billing_address end,
           shipping_address = case when p_shipping_address is not null
                                   then jsonb_build_object('address', p_shipping_address)
                                   else shipping_address end,
           updated_at = now()
     where id = v_cust_id;
  end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, detail)
  values (v_uid, 'customer.self_update', 'customer', v_cust_id::text,
          jsonb_build_object('contact_name', p_contact_name, 'contact_phone', p_contact_phone,
                             'company_name', p_company_name, 'company_phone', p_company_phone,
                             'billing_address', p_billing_address,
                             'shipping_address', p_shipping_address,
                             'applied_to_customer', v_verified));
end;
$$;

revoke execute on function public.update_my_customer(text, text, text, text, text, text) from public, anon;
grant execute on function public.update_my_customer(text, text, text, text, text, text) to authenticated;
