-- =========================================================================
-- 0060_attach_quote_customer.sql
-- Auto-attach a customer to a bot-created quote.
-- =========================================================================
-- When the bot creates a draft quote from chat it inserts a
-- 'sales.quote_request' agent task carrying { quote_id, conversation_id }.
-- This trigger fires on that insert and fills the quote's customer when it is
-- still blank ("ลูกค้าทั่วไป"), in priority order:
--   1. the conversation's already-linked customer, else
--   2. a customer derived from the conversation's "ใบกำกับภาษี" (tax_invoice)
--      note — found by tax id, or created from company name + address.
-- The note's address uses key `line1`; the customers/quote-document shape uses
-- `line`, so we map it. Never raises — quote creation/notify must not fail.
-- =========================================================================

create or replace function public.tg_attach_quote_customer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quote_id uuid;
  v_conv_id  uuid;
  v_cust     uuid;
  v_addr     jsonb;
  v_company  text;
  v_tax      text;
begin
  if new.kind <> 'sales.quote_request' then return new; end if;

  v_quote_id := nullif(new.payload->>'quote_id', '')::uuid;
  v_conv_id  := nullif(new.payload->>'conversation_id', '')::uuid;
  if v_quote_id is null or v_conv_id is null then return new; end if;

  -- Already has a customer → nothing to do.
  if exists (select 1 from public.quotes where id = v_quote_id and customer_id is not null) then
    return new;
  end if;

  -- (1) conversation already linked to a customer
  select customer_id into v_cust from public.chat_conversations where id = v_conv_id;
  if v_cust is not null then
    update public.quotes set customer_id = v_cust where id = v_quote_id;
    return new;
  end if;

  -- (2) derive from the tax_invoice note
  select address into v_addr from public.chat_contact_notes
   where conversation_id = v_conv_id and note_type = 'tax_invoice'
   order by updated_at desc limit 1;
  if v_addr is null then return new; end if;

  v_company := trim(coalesce(v_addr->>'company', ''));
  if v_company = '' then return new; end if;
  v_tax := trim(coalesce(v_addr->>'tax_id', ''));

  -- de-dupe by tax id when present
  if v_tax <> '' then
    select id into v_cust from public.customers where tax_id = v_tax limit 1;
  end if;

  if v_cust is null then
    insert into public.customers (name, tax_id, contact_name, phone, billing_address, source_channel)
    values (
      v_company,
      nullif(v_tax, ''),
      nullif(trim(coalesce(new.payload->>'name', '')), ''),
      nullif(trim(coalesce(new.payload->>'phone', '')), ''),
      jsonb_build_object(
        'line',        trim(coalesce(v_addr->>'line1', '')),
        'subdistrict', trim(coalesce(v_addr->>'subdistrict', '')),
        'district',    trim(coalesce(v_addr->>'district', '')),
        'province',    trim(coalesce(v_addr->>'province', '')),
        'postcode',    trim(coalesce(v_addr->>'postcode', ''))
      ),
      coalesce(nullif(new.payload->>'channel', ''), 'chat')
    )
    returning id into v_cust;
  end if;

  update public.quotes set customer_id = v_cust where id = v_quote_id;
  update public.chat_conversations set customer_id = v_cust
   where id = v_conv_id and customer_id is null;
  return new;
exception when others then
  return new; -- never block the task insert / team notification
end;
$$;

revoke execute on function public.tg_attach_quote_customer() from public, anon, authenticated;
grant  execute on function public.tg_attach_quote_customer() to service_role;

drop trigger if exists trg_attach_quote_customer on public.agent_tasks;
create trigger trg_attach_quote_customer
  after insert on public.agent_tasks
  for each row execute function public.tg_attach_quote_customer();
