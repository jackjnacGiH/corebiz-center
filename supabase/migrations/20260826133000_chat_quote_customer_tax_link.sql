-- =========================================================================
-- 20260826133000_chat_quote_customer_tax_link.sql
-- Require a tax-ID-linked CRM customer before chatbot quote creation.
-- =========================================================================
-- The tax ID is the only identity key used for automatic CRM matching. Names,
-- phones and LINE display names are deliberately excluded from matching so
-- similar contacts cannot create or attach to the wrong customer.

create unique index if not exists customers_tax_id_normalized_unique_idx
  on public.customers ((regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g')))
  where length(regexp_replace(coalesce(tax_id, ''), '[^0-9]', '', 'g')) = 13;

create or replace function public.link_chat_customer_by_tax(
  p_conversation_id uuid,
  p_tax_id text,
  p_company_name text,
  p_billing_address text,
  p_branch text default null,
  p_phone text default null
)
returns table (
  link_status text,
  customer_id uuid,
  customer_name text,
  linked_now boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tax text := regexp_replace(coalesce(p_tax_id, ''), '[^0-9]', '', 'g');
  v_company text := nullif(trim(coalesce(p_company_name, '')), '');
  v_address text := nullif(trim(coalesce(p_billing_address, '')), '');
  v_branch text := nullif(trim(coalesce(p_branch, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_existing_customer uuid;
  v_existing_tax text;
  v_customer uuid;
  v_customer_name text;
begin
  if p_conversation_id is null then
    return query select 'conversation_required'::text, null::uuid, null::text, false;
    return;
  end if;
  if length(v_tax) <> 13 then
    return query select 'tax_id_invalid'::text, null::uuid, null::text, false;
    return;
  end if;
  if v_company is null then
    return query select 'company_name_required'::text, null::uuid, null::text, false;
    return;
  end if;
  if v_address is null then
    return query select 'billing_address_required'::text, null::uuid, null::text, false;
    return;
  end if;

  select cc.customer_id,
         regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')
    into v_existing_customer, v_existing_tax
  from public.chat_conversations cc
  left join public.customers c on c.id = cc.customer_id
  where cc.id = p_conversation_id
  for update of cc;

  if not found then
    return query select 'conversation_not_found'::text, null::uuid, null::text, false;
    return;
  end if;
  if v_existing_customer is not null and v_existing_tax <> v_tax then
    return query select 'conversation_customer_conflict'::text, v_existing_customer, null::text, false;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('customer-tax:' || v_tax, 0));

  select c.id, c.name into v_customer, v_customer_name
  from public.customers c
  where regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g') = v_tax
  order by c.created_at
  limit 1;

  if v_customer is null then
    insert into public.customers (
      name, customer_type, tax_id, phone, billing_address, shipping_address,
      source_channel
    ) values (
      v_company, 'company', v_tax, v_phone,
      jsonb_strip_nulls(jsonb_build_object('line', v_address, 'branch', v_branch)),
      jsonb_strip_nulls(jsonb_build_object('line', v_address, 'branch', v_branch)),
      'chat_tax_id'
    )
    returning id, name into v_customer, v_customer_name;
  else
    -- Existing CRM data is authoritative. Only fill fields that are absent;
    -- never overwrite staff-maintained customer information from chat/OCR.
    update public.customers c
       set name = case when trim(c.name) = '' then v_company else c.name end,
           phone = coalesce(c.phone, v_phone),
           billing_address = coalesce(
             c.billing_address,
             jsonb_strip_nulls(jsonb_build_object('line', v_address, 'branch', v_branch))
           ),
           shipping_address = coalesce(
             c.shipping_address,
             jsonb_strip_nulls(jsonb_build_object('line', v_address, 'branch', v_branch))
           ),
           updated_at = now()
     where c.id = v_customer
     returning c.name into v_customer_name;
  end if;

  update public.chat_conversations
     set customer_id = v_customer,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'quote_customer_linked_at', now(),
           'quote_customer_link_method', 'tax_id'
         ),
         updated_at = now()
   where id = p_conversation_id
     and (customer_id is null or customer_id = v_customer);

  return query select
    case when v_existing_customer = v_customer then 'already_linked' else 'linked' end,
    v_customer,
    v_customer_name,
    v_existing_customer is distinct from v_customer;
end;
$$;

revoke execute on function public.link_chat_customer_by_tax(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.link_chat_customer_by_tax(uuid, text, text, text, text, text)
  to service_role;

comment on function public.link_chat_customer_by_tax(uuid, text, text, text, text, text) is
  'Links or creates a chat CRM customer using a normalized 13-digit tax ID as the sole identity key.';
