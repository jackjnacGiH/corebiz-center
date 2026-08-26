-- =========================================================================
-- 20260826070000_bot_quote_request_idempotency.sql
--
-- Make chatbot quotation creation idempotent per conversation + exact item
-- list. The advisory transaction lock closes the race where two LINE events
-- (for example, two images sent together) both see no prior draft and create
-- duplicate quote numbers. Existing legacy quote-request tasks are also
-- recognised by their conversation payload and non-shipping quote items.
-- =========================================================================

create or replace function public.create_or_reuse_bot_quote(
  p_conversation_id uuid,
  p_channel text,
  p_items jsonb,
  p_name text default null,
  p_phone text default null,
  p_note text default null
)
returns table(
  quote_id uuid,
  quote_code text,
  quote_total numeric,
  quote_created boolean,
  quote_reused boolean,
  items_resolved boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
  v_item_count integer;
  v_dedupe_key text;
  v_quote_id uuid;
  v_quote_code text;
  v_quote_total numeric;
  v_subtotal numeric;
  v_vat numeric;
begin
  -- Normalise and aggregate duplicate SKUs before using them as the request
  -- identity. Invalid/missing items simply fall back to the human task flow.
  with raw_items as (
    select upper(trim(item->>'sku')) as sku,
           greatest(
             1,
             floor(
               case
                 when coalesce(item->>'qty', '') ~ '^\d+(?:\.\d+)?$'
                   then (item->>'qty')::numeric
                 else 1
               end
             )
           )::integer as qty
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) item
    where coalesce(trim(item->>'sku'), '') <> ''
  ), grouped_items as (
    select sku, sum(qty)::integer as qty
    from raw_items
    group by sku
  )
  select jsonb_agg(jsonb_build_object('sku', sku, 'qty', qty) order by sku), count(*)::integer
    into v_items, v_item_count
  from grouped_items;

  if p_conversation_id is null or coalesce(v_item_count, 0) = 0 then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  v_dedupe_key := 'sales.quote_request.' || p_conversation_id::text || '.' || md5(v_items::text);

  -- Transaction-scoped lock: the second concurrent LINE event waits until the
  -- first event has inserted the quote and its request task, then reuses it.
  perform pg_advisory_xact_lock(hashtextextended(v_dedupe_key, 0));

  -- Reuse a current quote created by the new deterministic key, or a legacy
  -- task from the same chat whose non-shipping lines match exactly.
  select q.id, q.code, q.total
    into v_quote_id, v_quote_code, v_quote_total
  from public.agent_tasks task
  join public.quotes q
    on q.id = nullif(task.payload->>'quote_id', '')::uuid
  cross join lateral (
    select jsonb_agg(jsonb_build_object('sku', item.sku, 'qty', item.qty) order by item.sku) as items
    from (
      select upper(qi.sku) as sku, sum(qi.quantity)::integer as qty
      from public.quote_items qi
      where qi.quote_id = q.id and qi.sku <> 'SHIPPING'
      group by upper(qi.sku)
    ) item
  ) quote_items
  where task.kind = 'sales.quote_request'
    and task.payload->>'conversation_id' = p_conversation_id::text
    and q.status = 'draft'
    and q.converted_to_order_id is null
    and quote_items.items = v_items
  order by q.created_at asc
  limit 1;

  if found then
    return query select v_quote_id, v_quote_code, v_quote_total, false, true, true;
    return;
  end if;

  -- Never create a partial quote. Every requested SKU must resolve to an
  -- active product before any quote row is inserted.
  if (
    select count(*)::integer
    from public.products p
    join jsonb_array_elements(v_items) item on upper(p.sku) = item->>'sku'
    where p.status = 'active'
  ) <> v_item_count then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  insert into public.quotes (
    customer_id, status, subtotal, discount, vat, total, valid_until, notes
  ) values (
    null, 'draft', 0, 0, 0, 0, current_date + 30,
    '🤖 คำขอใบเสนอราคาจากแชทบอท (เอย)' || E'\n' ||
    concat_ws(E'\n',
      nullif('ชื่อผู้ติดต่อ: ' || nullif(trim(p_name), ''), 'ชื่อผู้ติดต่อ: '),
      nullif('โทร: ' || nullif(trim(p_phone), ''), 'โทร: '),
      nullif('หมายเหตุ: ' || nullif(trim(p_note), ''), 'หมายเหตุ: '),
      'ช่องทาง: ' || coalesce(nullif(trim(p_channel), ''), 'unknown')
    )
  ) returning id, code into v_quote_id, v_quote_code;

  insert into public.quote_items (
    quote_id, product_id, sku, product_name, quantity, unit_price, unit, discount, total
  )
  select
    v_quote_id,
    p.id,
    p.sku,
    p.name_th,
    (item->>'qty')::integer,
    round(greatest(
      0,
      coalesce(p.price, 0) - case
        when coalesce(p.discount_type, '') = 'percent'
          then coalesce(p.price, 0) * coalesce(p.discount_value, 0) / 100
        else coalesce(p.discount_value, 0)
      end
    ), 2),
    p.unit,
    0,
    round(greatest(
      0,
      coalesce(p.price, 0) - case
        when coalesce(p.discount_type, '') = 'percent'
          then coalesce(p.price, 0) * coalesce(p.discount_value, 0) / 100
        else coalesce(p.discount_value, 0)
      end
    ) * (item->>'qty')::integer, 2)
  from jsonb_array_elements(v_items) item
  join public.products p on upper(p.sku) = item->>'sku'
  where p.status = 'active';

  select coalesce(sum(total), 0) into v_subtotal
  from public.quote_items
  where quote_id = v_quote_id;
  v_vat := round(v_subtotal * 0.07, 2);
  v_quote_total := round(v_subtotal + v_vat, 2);

  update public.quotes
  set subtotal = v_subtotal, vat = v_vat, total = v_quote_total
  where id = v_quote_id;

  -- This one task also drives the existing customer-link and shipping triggers.
  perform public.agent_propose(
    'sales',
    'sales.quote_request',
    'ใบเสนอราคาจากแชทบอท ' || v_quote_code || ' — รอตรวจสอบ',
    'รายการ: ' || v_items::text || coalesce(' · ชื่อ: ' || nullif(trim(p_name), ''), '') ||
      coalesce(' · ติดต่อ: ' || nullif(trim(p_phone), ''), '') ||
      coalesce(' · โน้ต: ' || nullif(trim(p_note), ''), ''),
    'บอทสร้างใบเสนอราคาฉบับร่าง ' || v_quote_code || ' ให้แล้ว — ตรวจสอบราคา/ส่วนลด แล้วติดต่อยืนยันกับลูกค้า',
    jsonb_build_object(
      'items', v_items::text,
      'structured_items', v_items,
      'quote_id', v_quote_id,
      'quote_code', v_quote_code,
      'name', nullif(trim(p_name), ''),
      'phone', nullif(trim(p_phone), ''),
      'note', nullif(trim(p_note), ''),
      'channel', p_channel,
      'conversation_id', p_conversation_id
    ),
    'none', true, 1, 'quote', v_quote_id::text, v_dedupe_key, 'bot'
  );

  return query select v_quote_id, v_quote_code, v_quote_total, true, false, true;
end;
$$;

revoke execute on function public.create_or_reuse_bot_quote(uuid, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.create_or_reuse_bot_quote(uuid, text, jsonb, text, text, text) to service_role;
