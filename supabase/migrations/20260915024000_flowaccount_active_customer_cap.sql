-- Keep the FlowAccount history sync bounded to the 100 most recently active
-- verified LINE customers. Older eligible customers remain eligible for a
-- later run after their next inbound message moves them into the active set.

create or replace function public.get_flowaccount_active_customer_targets(
  p_days integer default 180,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
  v_target_count integer;
begin
  if p_days is null or p_days not between 1 and 180
     or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid_flowaccount_active_customer_request'
      using errcode = '22023';
  end if;

  with eligible as (
    select distinct on (conversation.customer_id)
      conversation.customer_id,
      regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g') as tax_id,
      conversation.last_customer_message_at
    from public.chat_conversations as conversation
    join public.customers as customer on customer.id = conversation.customer_id
    cross join lateral pricing_private.bot_pricing_context(conversation.id) as context
    where conversation.channel = 'line'
      and conversation.last_customer_message_at is not null
      and conversation.last_customer_message_at >=
        statement_timestamp() - make_interval(days => p_days)
      and context.customer_id = conversation.customer_id
      and context.personalized_allowed
      and regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
        ~ '^[0-9]{13}$'
      and (
        select count(*)
        from public.customers as duplicate
        where regexp_replace(coalesce(duplicate.tax_id, ''), '[^0-9]', '', 'g')
          = regexp_replace(coalesce(customer.tax_id, ''), '[^0-9]', '', 'g')
      ) = 1
    order by conversation.customer_id,
      conversation.last_customer_message_at desc,
      conversation.id
  ), bounded as (
    select eligible.*
    from eligible
    order by last_customer_message_at desc, customer_id
    limit p_limit
  )
  select count(*)::integer,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'customer_id', customer_id,
               'tax_id', tax_id
             ) order by last_customer_message_at desc, customer_id
           ),
           '[]'::jsonb
         )
    into v_target_count, v_targets
  from bounded;

  return jsonb_build_object(
    'window_days', p_days,
    'target_count', v_target_count,
    'targets', v_targets
  );
end;
$$;

revoke all on function public.get_flowaccount_active_customer_targets(integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_flowaccount_active_customer_targets(integer, integer)
  to service_role;

comment on function public.get_flowaccount_active_customer_targets(integer, integer) is
  'Returns at most the most recently active verified LINE customers for bounded read-only FlowAccount history sync.';
