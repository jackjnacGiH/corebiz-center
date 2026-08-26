-- =========================================================================
-- Backfill sales documents after a chat is linked to a verified CRM customer.
-- =========================================================================
-- Orders.tsx already renders the customer joined through customer_id. The gap
-- is historical quotes that were created before their chat was linked to CRM:
-- the link lives on chat_conversations, but the older quote stays NULL.
--
-- Safety rules:
--   * accept only a CRM customer with a normalized 13-digit tax ID;
--   * use the explicit quote_id + conversation_id stored by quote requests;
--   * fill NULL document links only; never replace a staff-selected customer;
--   * do not create or edit customer master data here.

create or replace function public.tg_fill_sales_customer_from_chat_link()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is null
     or new.customer_id is not distinct from old.customer_id then
    return new;
  end if;

  -- A chat is quote-ready only when its linked CRM record has the required
  -- 13-digit tax identity. Names, phones and LINE display names are not used
  -- for matching.
  if not exists (
    select 1
      from public.customers c
     where c.id = new.customer_id
       and length(regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')) = 13
  ) then
    return new;
  end if;

  with linked_quotes as (
    select distinct (at.payload->>'quote_id')::uuid as quote_id
      from public.agent_tasks at
     where at.kind = 'sales.quote_request'
       and at.payload->>'conversation_id' = new.id::text
       and coalesce(at.payload->>'quote_id', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  update public.quotes q
     set customer_id = new.customer_id,
         updated_at = now()
    from linked_quotes l
   where q.id = l.quote_id
     and q.customer_id is null;

  -- A converted order normally copies quote.customer_id during approval. This
  -- also repairs an older order when the CRM link happened after conversion.
  update public.orders o
     set customer_id = q.customer_id,
         updated_at = now()
    from public.quotes q
   where q.converted_to_order_id = o.id
     and q.customer_id = new.customer_id
     and o.customer_id is null;

  return new;
end;
$$;

revoke execute on function public.tg_fill_sales_customer_from_chat_link()
  from public, anon, authenticated;

drop trigger if exists fill_sales_customer_from_chat_link
  on public.chat_conversations;
create trigger fill_sales_customer_from_chat_link
  after update of customer_id on public.chat_conversations
  for each row
  when (
    new.customer_id is not null
    and new.customer_id is distinct from old.customer_id
  )
  execute function public.tg_fill_sales_customer_from_chat_link();

-- Keep a converted order in step when a quote is linked manually or by a
-- different trusted path after conversion. This is also NULL-only.
create or replace function public.tg_fill_order_customer_from_quote()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is null or new.converted_to_order_id is null then
    return new;
  end if;

  if not exists (
    select 1
      from public.customers c
     where c.id = new.customer_id
       and length(regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')) = 13
  ) then
    return new;
  end if;

  update public.orders o
     set customer_id = new.customer_id,
         updated_at = now()
   where o.id = new.converted_to_order_id
     and o.customer_id is null;

  return new;
end;
$$;

revoke execute on function public.tg_fill_order_customer_from_quote()
  from public, anon, authenticated;

drop trigger if exists fill_order_customer_from_quote on public.quotes;
create trigger fill_order_customer_from_quote
  after insert or update of customer_id, converted_to_order_id on public.quotes
  for each row execute function public.tg_fill_order_customer_from_quote();

-- One-time repair for quotes created before this trigger existed. If duplicate
-- task notifications exist for one quote, DISTINCT keeps the update singular.
with linked_quotes as (
  select distinct
         (at.payload->>'quote_id')::uuid as quote_id,
         nullif(at.payload->>'conversation_id', '')::uuid as conversation_id
    from public.agent_tasks at
   where at.kind = 'sales.quote_request'
     and coalesce(at.payload->>'quote_id', '')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and coalesce(at.payload->>'conversation_id', '')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), eligible as (
  select l.quote_id, cc.customer_id
    from linked_quotes l
    join public.chat_conversations cc on cc.id = l.conversation_id
    join public.customers c on c.id = cc.customer_id
   where length(regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')) = 13
)
update public.quotes q
   set customer_id = e.customer_id,
       updated_at = now()
  from eligible e
 where q.id = e.quote_id
   and q.customer_id is null;

-- Keep converted orders consistent with their source quote, also NULL-only.
update public.orders o
   set customer_id = q.customer_id,
       updated_at = now()
  from public.quotes q
  join public.customers c on c.id = q.customer_id
 where q.converted_to_order_id = o.id
   and o.customer_id is null
   and length(regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')) = 13;
