create extension if not exists http with schema extensions;

create or replace function public.shipping_flash_delivered_snapshot(p_tracking text)
returns table(delivered boolean, updated_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  response_status integer;
  response_content text;
  payload jsonb;
  shipment jsonb;
  delivered_route jsonb;
begin
  if p_tracking is null or p_tracking !~ '^[A-Za-z0-9-]{5,80}$' then
    return query select false, null::timestamptz;
    return;
  end if;

  perform set_config('http.curlopt_connecttimeout_msec', '5000', true);
  perform set_config('http.curlopt_timeout_msec', '12000', true);

  select result.status, result.content
  into response_status, response_content
  from extensions.http_post(
    'https://www.flashexpress.co.th/webApi/tools/tracking',
    jsonb_build_object('search', p_tracking)::text,
    'application/json'
  ) as result;

  if response_status <> 200
    or response_content is null
    or octet_length(response_content) > 1000000
  then
    return query select false, null::timestamptz;
    return;
  end if;

  payload := response_content::jsonb;
  if coalesce((payload->>'code')::integer, 0) <> 1 then
    return query select false, null::timestamptz;
    return;
  end if;

  select item into shipment
  from jsonb_array_elements(coalesce(payload #> '{data,list}', '[]'::jsonb)) as item
  where upper(coalesce(
    item->>'search_no',
    item->>'search_no_display',
    item->>'pno_display',
    ''
  )) = upper(p_tracking)
  limit 1;

  if shipment is null or coalesce((shipment->>'state')::integer, -1) <> 5 then
    return query select false, null::timestamptz;
    return;
  end if;

  select route into delivered_route
  from jsonb_array_elements(coalesce(shipment->'routes', '[]'::jsonb)) as route
  where upper(coalesce(route->>'route_action', '')) = 'DELIVERY_CONFIRM'
    and coalesce((route->>'state')::integer, -1) = 5
  order by route->>'routed_at' desc
  limit 1;

  if delivered_route is null or coalesce(delivered_route->>'routed_at', '') = '' then
    return query select false, null::timestamptz;
    return;
  end if;

  return query
  select true,
    ((delivered_route->>'routed_at')::timestamp at time zone 'Asia/Bangkok');
exception
  when others then
    return query select false, null::timestamptz;
end;
$$;

revoke all on function public.shipping_flash_delivered_snapshot(text) from public;
revoke all on function public.shipping_flash_delivered_snapshot(text) from anon;
revoke all on function public.shipping_flash_delivered_snapshot(text) from authenticated;
grant execute on function public.shipping_flash_delivered_snapshot(text) to service_role;

comment on function public.shipping_flash_delivered_snapshot(text) is
  'Reads the first-party Flash tracking endpoint from Postgres and returns only a confirmed delivery timestamp.';
