-- =========================================================================
-- Customer pricing phase 1
--
-- Adds one server-side price resolver used by bot quotations. Price priority:
--   customer net price > eligible FlowAccount quotation cache > Tier > base.
--
-- The FlowAccount cache is private and disabled until a verified sync marks a
-- company state enabled. This migration does not connect to FlowAccount and
-- does not expose cached document data through PostgREST.
-- =========================================================================

create schema if not exists pricing_private;
revoke all on schema pricing_private from public, anon, authenticated;
grant usage on schema pricing_private to service_role;

-- The live database already has these discount columns, but the oldest schema
-- migration did not declare them. Keep a fresh replay compatible before adding
-- the central resolver.
alter table public.products
  add column if not exists discount_value numeric(12,2) not null default 0;
alter table public.products
  add column if not exists discount_type text not null default 'fixed';
alter table public.products
  add column if not exists min_order_qty integer not null default 1;

update public.products set discount_value = 0 where discount_value is null;
update public.products set discount_type = 'fixed' where discount_type is null;
alter table public.products alter column discount_value set default 0;
alter table public.products alter column discount_value set not null;
alter table public.products alter column discount_type set default 'fixed';
alter table public.products alter column discount_type set not null;
update public.products set min_order_qty = 1 where min_order_qty is null or min_order_qty < 1;
alter table public.products alter column min_order_qty set default 1;
alter table public.products alter column min_order_qty set not null;

-- A price revision changes only when a field used by the resolver changes.
-- It lets quote fingerprints detect a price edit even when updated_at is also
-- used for unrelated catalogue edits.
alter table public.products add column if not exists price_updated_at timestamptz;
update public.products
set price_updated_at = coalesce(updated_at, now())
where price_updated_at is null;
alter table public.products alter column price_updated_at set default now();
alter table public.products alter column price_updated_at set not null;

create or replace function pricing_private.touch_product_price_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(new.price, new.discount_value, new.discount_type)
     is distinct from row(old.price, old.discount_value, old.discount_type)
  then
    new.price_updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function pricing_private.touch_product_price_revision()
  from public, anon, authenticated;

drop trigger if exists trg_products_price_revision on public.products;
create trigger trg_products_price_revision
before update of price, discount_value, discount_type on public.products
for each row execute function pricing_private.touch_product_price_revision();

create index if not exists products_sku_upper_idx
  on public.products (upper(btrim(sku)));

-- Explicit CoreBiz price agreed for one customer, product and unit. It applies
-- to every quantity; quantity-specific historical pricing remains a separate,
-- fail-closed FlowAccount rule.
-- A stricter single-active rule avoids overlapping rules and closes concurrent
-- insert races. Replace a rule by deactivating it before inserting its successor.
create table if not exists public.customer_product_net_prices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  unit text not null check (btrim(unit) <> ''),
  unit_key text generated always as (lower(btrim(unit))) stored,
  net_price numeric(14,2) not null check (net_price > 0),
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from)
);

create unique index if not exists customer_product_net_prices_active_uidx
  on public.customer_product_net_prices
    (customer_id, product_id, unit_key)
  where active;

create index if not exists customer_product_net_prices_resolver_idx
  on public.customer_product_net_prices
    (customer_id, product_id, unit_key, valid_from desc, id)
  where active;

create or replace function pricing_private.stamp_customer_product_net_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_unit text;
begin
  select p.unit into v_product_unit
  from public.products p
  where p.id = new.product_id;
  if not found or nullif(btrim(v_product_unit), '') is null then
    raise exception 'product_unit_not_found' using errcode = '23503';
  end if;
  new.unit := v_product_unit;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function pricing_private.audit_customer_product_net_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.customer_product_net_prices;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, detail)
  values (
    auth.uid(),
    'customer_pricing.' || lower(tg_op),
    'customer_product_net_price',
    v_row.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'customer_id', v_row.customer_id,
      'product_id', v_row.product_id,
      'unit', v_row.unit,
      'active', v_row.active,
      'old_net_price', case when tg_op in ('UPDATE','DELETE') then old.net_price end,
      'new_net_price', case when tg_op in ('INSERT','UPDATE') then new.net_price end,
      'valid_from', v_row.valid_from,
      'valid_until', v_row.valid_until
    ))
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function pricing_private.stamp_customer_product_net_price()
  from public, anon, authenticated;
revoke all on function pricing_private.audit_customer_product_net_price()
  from public, anon, authenticated;

drop trigger if exists trg_customer_product_net_prices_stamp
  on public.customer_product_net_prices;
create trigger trg_customer_product_net_prices_stamp
before insert or update on public.customer_product_net_prices
for each row execute function pricing_private.stamp_customer_product_net_price();

drop trigger if exists trg_customer_product_net_prices_audit
  on public.customer_product_net_prices;
create trigger trg_customer_product_net_prices_audit
after insert or update or delete on public.customer_product_net_prices
for each row execute function pricing_private.audit_customer_product_net_price();

alter table public.customer_product_net_prices enable row level security;
revoke all on public.customer_product_net_prices
  from public, anon, authenticated;
grant select, insert, update on public.customer_product_net_prices
  to authenticated;
grant all on public.customer_product_net_prices to service_role;

drop policy if exists customer_product_net_prices_owner_read
  on public.customer_product_net_prices;
create policy customer_product_net_prices_owner_read
  on public.customer_product_net_prices
  for select to authenticated
  using (public.can_delete());

drop policy if exists customer_product_net_prices_owner_insert
  on public.customer_product_net_prices;
create policy customer_product_net_prices_owner_insert
  on public.customer_product_net_prices
  for insert to authenticated
  with check (public.can_delete());

drop policy if exists customer_product_net_prices_owner_update
  on public.customer_product_net_prices;
create policy customer_product_net_prices_owner_update
  on public.customer_product_net_prices
  for update to authenticated
  using (public.can_delete())
  with check (public.can_delete());

-- Normalized, derived sell-price rows only. Raw documents, contact addresses,
-- bank fields, tokens and product cost are deliberately not stored here.
create table if not exists pricing_private.flowaccount_quote_price_cache (
  id uuid primary key default gen_random_uuid(),
  company_key text not null check (btrim(company_key) <> ''),
  -- A completed sync publishes one immutable generation. Rows from older
  -- generations remain available for audit/retry but can never win pricing.
  sync_run_id uuid not null,
  document_record_id bigint not null check (document_record_id > 0),
  line_key text not null check (btrim(line_key) <> ''),
  document_serial text,
  document_status integer not null,
  published_on date not null,
  source_updated_at timestamptz not null,
  source_contact_id bigint,
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  source_sku text not null check (btrim(source_sku) <> ''),
  source_unit text not null check (btrim(source_unit) <> ''),
  unit_key text generated always as (lower(btrim(source_unit))) stored,
  source_quantity numeric(14,3) not null check (source_quantity > 0),
  net_unit_price numeric(14,2) not null check (net_unit_price > 0),
  currency text not null default 'THB' check (currency = upper(currency) and length(currency) = 3),
  eligible boolean not null default false,
  eligibility_reason text,
  source_hash text not null check (btrim(source_hash) <> ''),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (company_key, sync_run_id, document_record_id, line_key)
);

create index if not exists flowaccount_quote_price_cache_resolver_idx
  on pricing_private.flowaccount_quote_price_cache
    (customer_id, product_id, unit_key, source_quantity, sync_run_id,
     published_on desc, document_record_id desc, line_key desc)
  where eligible and currency = 'THB';

-- No row is inserted by this migration. Therefore FlowAccount history cannot
-- influence a quote until a verified sync explicitly creates and enables a
-- state row after a complete successful run.
create table if not exists pricing_private.flowaccount_price_sync_state (
  company_key text primary key check (btrim(company_key) <> ''),
  enabled boolean not null default false,
  last_success_at timestamptz,
  last_success_run_id uuid,
  stale_after_minutes integer not null default 1440
    check (stale_after_minutes between 5 and 10080),
  max_document_age_days integer not null default 180
    check (max_document_age_days between 1 and 3650),
  last_source_hash text,
  updated_at timestamptz not null default now(),
  check (not enabled or (
    last_success_at is not null and last_success_run_id is not null
  ))
);

alter table pricing_private.flowaccount_quote_price_cache enable row level security;
alter table pricing_private.flowaccount_price_sync_state enable row level security;
revoke all on pricing_private.flowaccount_quote_price_cache,
  pricing_private.flowaccount_price_sync_state
  from public, anon, authenticated;
grant all on pricing_private.flowaccount_quote_price_cache,
  pricing_private.flowaccount_price_sync_state
  to service_role;

-- Snapshot fields keep an issued quote stable when catalogue, Tier, net-price
-- rules or the external cache later change.
alter table public.quotes
  add column if not exists pricing_fingerprint text;
alter table public.quotes
  add column if not exists pricing_resolved_at timestamptz;

alter table public.quote_items
  add column if not exists base_unit_price numeric(14,2);
alter table public.quote_items
  add column if not exists price_source text not null default 'unspecified';
alter table public.quote_items
  add column if not exists tier_percent numeric(5,2);
alter table public.quote_items
  add column if not exists net_rule_id uuid
    references public.customer_product_net_prices(id) on delete set null;
alter table public.quote_items
  add column if not exists pricing_snapshot jsonb;
alter table public.quote_items
  add column if not exists price_fingerprint text;
alter table public.quote_items
  add column if not exists price_resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'quote_items_price_source_check'
      and conrelid = 'public.quote_items'::regclass
  ) then
    alter table public.quote_items
      add constraint quote_items_price_source_check
      check (price_source in
        ('unspecified','base','tier','customer_net','flowaccount_quote','manual','shipping'));
  end if;
end;
$$;

create index if not exists quotes_bot_pricing_reuse_idx
  on public.quotes (customer_id, pricing_fingerprint, created_at desc, id)
  where status = 'draft' and converted_to_order_id is null;

-- Internal set-based resolver. p_items accepts bot-style {sku,qty,unit?} or
-- staff UI-style {product_id,quantity,unit?}. When both identifiers are sent
-- they must identify the same active product. Duplicate equal items aggregate.
create or replace function pricing_private.resolve_quote_items(
  p_customer_id uuid,
  p_items jsonb,
  p_allow_personalized boolean
)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  quantity integer,
  list_price numeric,
  normal_discount_type text,
  normal_discount_value numeric,
  base_price numeric,
  tier text,
  tier_percent numeric,
  net_rule_id uuid,
  net_price numeric,
  flowaccount_price_cache_id uuid,
  final_price numeric,
  price_source text,
  price_fingerprint text,
  resolved_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with input_items as (
    select
      item,
      nullif(btrim(item->>'sku'), '') as sku_text,
      nullif(btrim(item->>'product_id'), '') as product_id_text,
      coalesce(item->>'qty', item->>'quantity') as quantity_text
    from jsonb_array_elements(
      case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
    ) item
  ), input_validity as (
    select coalesce(count(*) between 1 and 100 and bool_and(
      (
        sku_text is not null
        or coalesce(product_id_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      and (
        product_id_text is null
        or product_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      and case
        when coalesce(quantity_text, '') ~ '^\d+(?:\.\d+)?$' then
          quantity_text::numeric = trunc(quantity_text::numeric)
          and quantity_text::numeric between 1 and 1000000
        else false
      end
    ), false) as valid
    from input_items
  ), raw_items as (
    select
      case when product_id_text is not null then product_id_text::uuid end as requested_product_id,
      upper(sku_text) as requested_sku,
      nullif(btrim(item->>'unit'), '') as requested_unit,
      quantity_text::numeric::integer as quantity
    from input_items
    cross join input_validity validity
    where validity.valid
  ), requested as (
    select requested_product_id, requested_sku,
           max(requested_unit) as requested_unit,
           sum(quantity)::integer as quantity
    from raw_items
    group by requested_product_id, requested_sku
    having count(distinct lower(btrim(requested_unit))) <= 1
       and sum(quantity) between 1 and 1000000
  ), product_candidates as (
    select
      r.requested_product_id,
      r.requested_sku,
      r.requested_unit,
      r.quantity,
      p.id as product_id,
      p.sku,
      p.name_th,
      p.unit as product_unit,
      greatest(1, coalesce(p.min_order_qty, 1)) as min_order_qty,
      coalesce(p.price, 0)::numeric as list_price,
      coalesce(p.discount_type, 'fixed') as discount_type,
      coalesce(p.discount_value, 0)::numeric as discount_value,
      p.price_updated_at,
      count(*) over (
        partition by r.requested_product_id, r.requested_sku, r.requested_unit
      ) as match_count
    from requested r
    join public.products p
      on (
        (r.requested_product_id is not null and p.id = r.requested_product_id)
        or (r.requested_product_id is null and upper(btrim(p.sku)) = r.requested_sku)
      )
     and (r.requested_sku is null or upper(btrim(p.sku)) = r.requested_sku)
     and p.status = 'active'
  ), matched as (
    select
      pc.*,
      pc.product_unit as resolved_unit,
      lower(btrim(pc.product_unit)) as unit_key,
      round(greatest(
        0,
        pc.list_price - case
          when pc.discount_type = 'percent'
            then pc.list_price * pc.discount_value / 100
          else pc.discount_value
        end
      ), 2) as base_price
    from product_candidates pc
    where pc.match_count = 1
      and pc.quantity >= pc.min_order_qty
      and (
        pc.requested_unit is null
        or lower(btrim(pc.requested_unit)) = lower(btrim(pc.product_unit))
      )
  ), customer_context as (
    select
      c.id as customer_id,
      case when p_allow_personalized
        then coalesce(c.tier, 'general')
        else 'general'
      end as tier,
      case when p_allow_personalized and c.id is not null
        then least(100::numeric, greatest(0::numeric, coalesce(tb.discount_percent, 0)))
        else 0::numeric
      end as tier_percent,
      case when p_allow_personalized then tb.updated_at end as tier_updated_at
    from (select 1) seed
    left join public.customers c on c.id = p_customer_id
    left join public.tier_benefits tb on tb.tier = coalesce(c.tier, 'general')
  ), candidates as (
    select
      m.*,
      cc.tier,
      coalesce(cc.tier_percent, 0) as tier_percent,
      cc.tier_updated_at,
      net.id as net_rule_id,
      net.net_price,
      flow.id as flow_cache_id,
      flow.net_unit_price as flow_net_price,
      flow.published_on as flow_published_on
    from matched m
    cross join customer_context cc
    left join lateral (
      select n.id, n.net_price
      from public.customer_product_net_prices n
      where n.customer_id = p_customer_id
        and n.product_id = m.product_id
        and n.unit_key = m.unit_key
        and n.active
        and p_allow_personalized
        and n.valid_from <= statement_timestamp()
        and (n.valid_until is null or n.valid_until > statement_timestamp())
      order by n.valid_from desc, n.updated_at desc, n.id
      limit 1
    ) net on true
    left join lateral (
      select f.id, f.net_unit_price, f.published_on
      from pricing_private.flowaccount_quote_price_cache f
      join pricing_private.flowaccount_price_sync_state s
        on s.company_key = f.company_key
       and s.last_success_run_id = f.sync_run_id
       and s.enabled
       and s.last_success_at >= statement_timestamp()
          - make_interval(mins => s.stale_after_minutes)
      where f.customer_id = p_customer_id
        and f.product_id = m.product_id
        and upper(btrim(f.source_sku)) = upper(btrim(m.sku))
        and f.unit_key = m.unit_key
        and f.source_quantity = m.quantity
        and f.currency = 'THB'
        and f.eligible
        and p_allow_personalized
        and f.published_on >= current_date - s.max_document_age_days
        and f.published_on >= m.price_updated_at::date
        and f.source_updated_at >= m.price_updated_at
      order by f.published_on desc, f.document_record_id desc, f.line_key desc
      limit 1
    ) flow on true
  ), priced as (
    select
      c.*,
      case
        when c.net_rule_id is not null then c.net_price
        when c.flow_cache_id is not null then c.flow_net_price
        when c.tier_percent > 0 then round(c.base_price * (1 - c.tier_percent / 100), 2)
        else c.base_price
      end as final_price,
      case
        when c.net_rule_id is not null then 'customer_net'
        when c.flow_cache_id is not null then 'flowaccount_quote'
        when c.tier_percent > 0 then 'tier'
        else 'base'
      end as price_source
    from candidates c
  )
  select
    p.product_id,
    p.sku,
    p.name_th,
    p.resolved_unit,
    p.quantity,
    round(p.list_price, 2),
    p.discount_type,
    p.discount_value,
    p.base_price,
    p.tier,
    p.tier_percent,
    p.net_rule_id,
    p.net_price,
    p.flow_cache_id,
    round(p.final_price, 2),
    p.price_source,
    md5(concat_ws('|',
      'customer-pricing-v1', p_customer_id::text, p.product_id::text,
      upper(btrim(p.sku)), lower(btrim(p.resolved_unit)), p.quantity::text,
      p.price_source, round(p.final_price, 2)::text,
      coalesce(p.net_rule_id::text, ''),
      coalesce(p.tier::text, ''), p.tier_percent::text,
      coalesce(p.price_updated_at::text, ''), coalesce(p.tier_updated_at::text, ''),
      p_allow_personalized::text
    )),
    statement_timestamp()
  from priced p
  where p.final_price > 0
  order by upper(btrim(p.sku)), lower(btrim(p.resolved_unit));
$$;

revoke all on function pricing_private.resolve_quote_items(uuid, jsonb, boolean)
  from public, anon, authenticated;

-- Internal read-role resolver contract. It reveals the selected sell price and
-- rule identity, never raw FlowAccount documents or product cost.
create or replace function public.resolve_customer_quote_prices(
  p_customer_id uuid,
  p_items jsonb
)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  quantity integer,
  list_price numeric,
  normal_discount_type text,
  normal_discount_value numeric,
  base_price numeric,
  tier text,
  tier_percent numeric,
  net_rule_id uuid,
  net_price numeric,
  final_price numeric,
  price_source text,
  price_fingerprint text,
  resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_customer_id) then
    raise exception 'customer_not_found' using errcode = '22023';
  end if;
  return query
    select
      r.product_id, r.sku, r.product_name, r.unit, r.quantity,
      r.list_price, r.normal_discount_type, r.normal_discount_value,
      r.base_price, r.tier, r.tier_percent, r.net_rule_id, r.net_price,
      r.final_price, r.price_source, r.price_fingerprint, r.resolved_at
    from pricing_private.resolve_quote_items(p_customer_id, p_items, true) r;
end;
$$;

revoke all on function public.resolve_customer_quote_prices(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.resolve_customer_quote_prices(uuid, jsonb)
  to authenticated;

-- Sanitized list for the customer-pricing panel. Internal read roles can
-- inspect approved sell-price rules without direct table access or creator UUIDs.
create or replace function public.list_customer_product_net_prices(
  p_customer_id uuid
)
returns table (
  id uuid,
  customer_id uuid,
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  min_order_qty integer,
  net_price numeric,
  active boolean,
  valid_from timestamptz,
  valid_until timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select n.id, n.customer_id, n.product_id, p.sku, p.name_th,
           n.unit, greatest(1, coalesce(p.min_order_qty, 1)),
           n.net_price, n.active, n.valid_from, n.valid_until,
           n.note, n.created_at, n.updated_at
    from public.customer_product_net_prices n
    join public.products p on p.id = n.product_id
    where n.customer_id = p_customer_id
    order by p.name_th, p.sku, n.unit_key, n.valid_from desc, n.id;
end;
$$;

revoke all on function public.list_customer_product_net_prices(uuid)
  from public, anon, service_role;
grant execute on function public.list_customer_product_net_prices(uuid)
  to authenticated;

-- One source of truth for whether a bot conversation may use personalized
-- prices. It returns a context even when no customer is ready so a read-only
-- price lookup can safely fall back to base pricing.
create or replace function pricing_private.bot_pricing_context(
  p_conversation_id uuid
)
returns table (
  customer_id uuid,
  personalized_allowed boolean,
  pricing_context_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found boolean := false;
  v_customer_id uuid;
  v_tax_id text;
  v_metadata jsonb;
  v_channel text;
  v_external_id text;
begin
  select true, cc.customer_id,
         regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g'),
         cc.metadata, cc.channel, cc.external_id
    into v_found, v_customer_id, v_tax_id, v_metadata, v_channel, v_external_id
  from public.chat_conversations cc
  left join public.customers c on c.id = cc.customer_id
  where cc.id = p_conversation_id;

  if not coalesce(v_found, false) then
    return query select null::uuid, false, 'no_verified_customer_context'::text;
    return;
  end if;
  if v_customer_id is null then
    return query select null::uuid, false, 'no_verified_customer_context'::text;
    return;
  end if;
  if length(v_tax_id) <> 13 then
    return query select v_customer_id, false, 'tax_customer_required'::text;
    return;
  end if;

  if coalesce(v_metadata->>'quote_customer_link_method', '') <> 'tax_id' then
    return query select v_customer_id, true, 'manual_or_preexisting_link'::text;
    return;
  end if;
  if nullif(v_metadata->>'price_history_verified_at', '') is not null then
    return query select v_customer_id, true, 'price_history_verified'::text;
    return;
  end if;
  if exists (
    select 1
    from public.customer_contacts contact
    join public.profiles profile on profile.id = contact.user_id
    where contact.customer_id = v_customer_id
      and contact.verified
      and v_channel = 'line'
      and profile.line_user_id = v_external_id
  ) then
    return query select v_customer_id, true, 'verified_customer_contact'::text;
    return;
  end if;

  return query select v_customer_id, false, 'tax_link_pending_verification'::text;
end;
$$;

revoke all on function pricing_private.bot_pricing_context(uuid)
  from public, anon, authenticated;

-- Narrow service-only price lookup for the chatbot. It intentionally omits
-- FlowAccount document/cache identifiers and manual-rule creator identities.
create or replace function public.resolve_bot_quote_prices(
  p_conversation_id uuid,
  p_items jsonb
)
returns table (
  product_id uuid,
  sku text,
  product_name text,
  unit text,
  quantity integer,
  list_price numeric,
  normal_discount_type text,
  normal_discount_value numeric,
  base_price numeric,
  tier text,
  tier_percent numeric,
  net_rule_id uuid,
  net_price numeric,
  final_price numeric,
  price_source text,
  price_fingerprint text,
  resolved_at timestamptz,
  personalized_allowed boolean,
  pricing_context_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.product_id, r.sku, r.product_name, r.unit, r.quantity,
    r.list_price, r.normal_discount_type, r.normal_discount_value,
    r.base_price, r.tier, r.tier_percent, r.net_rule_id, r.net_price,
    r.final_price, r.price_source, r.price_fingerprint, r.resolved_at,
    context.personalized_allowed, context.pricing_context_reason
  from pricing_private.bot_pricing_context(p_conversation_id) context
  cross join lateral pricing_private.resolve_quote_items(
    context.customer_id, p_items, context.personalized_allowed
  ) r;
$$;

revoke all on function public.resolve_bot_quote_prices(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.resolve_bot_quote_prices(uuid, jsonb)
  to service_role;

-- Keep the existing signature and return contract so the deployed rag-chat
-- function needs no change. Customer identity and price resolution now happen
-- atomically before the draft is inserted.
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
  v_resolved jsonb;
  v_resolved_count integer;
  v_customer_id uuid;
  v_customer_tax_id text;
  v_allow_personalized boolean;
  v_pricing_context_reason text;
  v_pricing_fingerprint text;
  v_dedupe_key text;
  v_lock_key text;
  v_quote_id uuid;
  v_quote_code text;
  v_quote_total numeric;
  v_subtotal numeric;
  v_vat numeric;
  v_resolved_at timestamptz := statement_timestamp();
  v_input_valid boolean;
  v_task_dedupe_key text;
begin
  select case
    when jsonb_typeof(p_items) <> 'array' then false
    when jsonb_array_length(p_items) = 0 then false
    when jsonb_array_length(p_items) > 100 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_items) item
      where coalesce(trim(item->>'sku'), '') = ''
         or not (
           case
             when coalesce(item->>'qty', '') ~ '^\d+(?:\.\d+)?$' then
               (item->>'qty')::numeric = trunc((item->>'qty')::numeric)
               and (item->>'qty')::numeric between 1 and 1000000
             else false
           end
         )
    )
  end into v_input_valid;

  if not coalesce(v_input_valid, false) then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  with raw_items as (
    select upper(trim(item->>'sku')) as sku,
           lower(nullif(trim(item->>'unit'), '')) as unit,
           (item->>'qty')::numeric::integer as qty
    from jsonb_array_elements(p_items) item
  ), grouped_items as (
    select sku, max(unit) as unit, sum(qty)::bigint as qty,
           count(distinct unit) <= 1 as units_valid
    from raw_items
    group by sku
  )
  select
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object('sku', sku, 'unit', unit, 'qty', qty))
      order by sku, unit nulls first
    ),
    count(*)::integer,
    bool_and(units_valid and qty between 1 and 1000000)
  into v_items, v_item_count, v_input_valid
  from grouped_items;

  if p_conversation_id is null or coalesce(v_item_count, 0) = 0
     or not coalesce(v_input_valid, false) then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  select cc.customer_id,
         regexp_replace(coalesce(c.tax_id, ''), '[^0-9]', '', 'g')
  into v_customer_id, v_customer_tax_id
  from public.chat_conversations cc
  left join public.customers c on c.id = cc.customer_id
  where cc.id = p_conversation_id
  for update of cc;

  if not found or v_customer_id is null or length(v_customer_tax_id) <> 13 then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  select context.personalized_allowed, context.pricing_context_reason
  into v_allow_personalized, v_pricing_context_reason
  from pricing_private.bot_pricing_context(p_conversation_id) context;

  -- Serialize equal requests before resolving. A concurrent rule/cache update is
  -- then observed as one coherent statement snapshot and cannot create twins.
  v_lock_key := 'sales.quote_request.' || p_conversation_id::text || '.' ||
    v_customer_id::text || '.' || md5(v_items::text);
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select
    jsonb_agg(to_jsonb(r) order by r.sku, r.unit),
    count(*)::integer
  into v_resolved, v_resolved_count
  from pricing_private.resolve_quote_items(
    v_customer_id, v_items, v_allow_personalized
  ) r;

  if coalesce(v_resolved_count, 0) <> v_item_count then
    return query select null::uuid, null::text, null::numeric, false, false, false;
    return;
  end if;

  select md5(
    v_customer_id::text || '|' ||
    coalesce(jsonb_agg(jsonb_build_object(
      'sku', item->>'sku',
      'unit', item->>'unit',
      'quantity', item->>'quantity',
      'price_fingerprint', item->>'price_fingerprint'
    ) order by item->>'sku', item->>'unit')::text, '[]')
  )
  into v_pricing_fingerprint
  from jsonb_array_elements(v_resolved) item;

  v_dedupe_key := v_lock_key || '.' || v_pricing_fingerprint;

  select q.id, q.code, q.total
  into v_quote_id, v_quote_code, v_quote_total
  from public.agent_tasks task
  join public.quotes q
    on q.id = nullif(task.payload->>'quote_id', '')::uuid
  where task.kind = 'sales.quote_request'
    and task.payload->>'conversation_id' = p_conversation_id::text
    and task.payload->>'pricing_fingerprint' = v_pricing_fingerprint
    and q.customer_id = v_customer_id
    and q.pricing_fingerprint = v_pricing_fingerprint
    and q.status = 'draft'
    and q.converted_to_order_id is null
    and not exists (
      select 1
      from jsonb_array_elements(v_resolved) expected
      full join (
        select upper(qi.sku) as sku,
               lower(btrim(coalesce(qi.unit, ''))) as unit,
               sum(qi.quantity)::integer as quantity,
               min(qi.price_fingerprint) as price_fingerprint,
               count(distinct qi.price_fingerprint) as fingerprint_count
        from public.quote_items qi
        where qi.quote_id = q.id and qi.sku <> 'SHIPPING'
        group by upper(qi.sku), lower(btrim(coalesce(qi.unit, '')))
      ) actual
        on actual.sku = upper(expected->>'sku')
       and actual.unit = lower(btrim(expected->>'unit'))
      where actual.sku is null
         or expected is null
         or actual.quantity <> (expected->>'quantity')::integer
         or actual.fingerprint_count <> 1
         or actual.price_fingerprint is distinct from expected->>'price_fingerprint'
    )
  order by q.created_at desc
  limit 1;

  if found then
    return query select v_quote_id, v_quote_code, v_quote_total, false, true, true;
    return;
  end if;

  insert into public.quotes (
    customer_id, status, subtotal, discount, vat, total, valid_until, notes,
    pricing_fingerprint, pricing_resolved_at
  ) values (
    v_customer_id, 'draft', 0, 0, 0, 0, current_date + 30,
    '🤖 คำขอใบเสนอราคาจากแชทบอท (เอย)' || E'\n' ||
    concat_ws(E'\n',
      nullif('ชื่อผู้ติดต่อ: ' || nullif(trim(p_name), ''), 'ชื่อผู้ติดต่อ: '),
      nullif('โทร: ' || nullif(trim(p_phone), ''), 'โทร: '),
      nullif('หมายเหตุ: ' || nullif(trim(p_note), ''), 'หมายเหตุ: '),
      'ช่องทาง: ' || coalesce(nullif(trim(p_channel), ''), 'unknown')
    ),
    v_pricing_fingerprint, v_resolved_at
  ) returning id, code into v_quote_id, v_quote_code;

  -- One task per created quote. The quote id avoids colliding with a completed
  -- task from an older request at the same price, while the prefix retains the
  -- customer, item and price fingerprint for audit/reconciliation.
  v_task_dedupe_key := v_dedupe_key || '.' || v_quote_id::text;

  insert into public.quote_items (
    quote_id, product_id, sku, product_name, quantity, unit_price, unit,
    discount, total, base_unit_price, price_source, tier_percent, net_rule_id,
    pricing_snapshot, price_fingerprint, price_resolved_at
  )
  select
    v_quote_id,
    (item->>'product_id')::uuid,
    item->>'sku',
    item->>'product_name',
    (item->>'quantity')::integer,
    (item->>'final_price')::numeric,
    item->>'unit',
    0,
    round((item->>'final_price')::numeric * (item->>'quantity')::integer, 2),
    (item->>'base_price')::numeric,
    item->>'price_source',
    (item->>'tier_percent')::numeric,
    nullif(item->>'net_rule_id', '')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'version', 1,
      'list_price', (item->>'list_price')::numeric,
      'normal_discount_type', item->>'normal_discount_type',
      'normal_discount_value', (item->>'normal_discount_value')::numeric,
      'base_price', (item->>'base_price')::numeric,
      'tier', item->>'tier',
      'tier_percent', (item->>'tier_percent')::numeric,
      'net_rule_id', nullif(item->>'net_rule_id', ''),
      'final_price', (item->>'final_price')::numeric,
      'price_source', item->>'price_source'
    )),
    item->>'price_fingerprint',
    v_resolved_at
  from jsonb_array_elements(v_resolved) item;

  select coalesce(sum(qi.total), 0) into v_subtotal
  from public.quote_items qi
  where qi.quote_id = v_quote_id;
  v_vat := round(v_subtotal * 0.07, 2);
  v_quote_total := round(v_subtotal + v_vat, 2);

  update public.quotes
  set subtotal = v_subtotal, discount = 0, vat = v_vat, total = v_quote_total
  where id = v_quote_id;

  insert into public.audit_logs(actor_id, action, target_type, target_id, detail)
  values (
    null,
    'quote.pricing_resolved',
    'quote',
    v_quote_id::text,
    jsonb_build_object(
      'pricing_fingerprint', v_pricing_fingerprint,
      'sources', (
        select jsonb_object_agg(source, source_count)
        from (
          select item->>'price_source' as source, count(*) as source_count
          from jsonb_array_elements(v_resolved) item
          group by item->>'price_source'
        ) counts
      )
    )
  );

  perform public.agent_propose(
    'sales',
    'sales.quote_request',
    'ใบเสนอราคาจากแชทบอท ' || v_quote_code,
    'รายการ: ' || v_items::text || coalesce(' · ชื่อ: ' || nullif(trim(p_name), ''), '') ||
      coalesce(' · ติดต่อ: ' || nullif(trim(p_phone), ''), '') ||
      coalesce(' · โน้ต: ' || nullif(trim(p_note), ''), ''),
    'ระบบสร้างใบเสนอราคาฉบับร่าง ' || v_quote_code || ' และส่งลิงก์ให้ลูกค้าตาม flow อัตโนมัติแล้ว',
    jsonb_build_object(
      'items', v_items::text,
      'structured_items', v_items,
      'quote_id', v_quote_id,
      'quote_code', v_quote_code,
      'name', nullif(trim(p_name), ''),
      'phone', nullif(trim(p_phone), ''),
      'note', nullif(trim(p_note), ''),
      'channel', p_channel,
      'conversation_id', p_conversation_id,
      'pricing_fingerprint', v_pricing_fingerprint,
      'personalized_pricing', v_allow_personalized,
      'pricing_context_reason', v_pricing_context_reason
    ),
    'none', false, 1::smallint, 'quote', v_quote_id::text, v_task_dedupe_key, 'bot'
  );

  -- Agent-task triggers may append SHIPPING and recompute VAT/total. Return the
  -- stored post-trigger total so the first response matches later reuse calls.
  select q.total
  into v_quote_total
  from public.quotes q
  where q.id = v_quote_id;

  return query select v_quote_id, v_quote_code, v_quote_total, true, false, true;
end;
$$;

revoke execute on function public.create_or_reuse_bot_quote(uuid, text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_or_reuse_bot_quote(uuid, text, jsonb, text, text, text)
  to service_role;

-- These SECURITY DEFINER helpers are internal building blocks. Older
-- migrations left them callable by browser roles, which could let an untrusted
-- caller create arbitrary agent tasks or append a shipping line to a quote by
-- UUID. Edge Functions use service_role, while database triggers/definer
-- functions execute as their owner, so browser access is neither needed nor
-- safe.
revoke all on function public.agent_propose(
  text, text, text, text, text, jsonb, text, boolean, smallint,
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.agent_propose(
  text, text, text, text, text, jsonb, text, boolean, smallint,
  text, text, text, text
) to service_role;

revoke all on function public.apply_quote_shipping(uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.apply_quote_shipping(uuid, numeric)
  to service_role;
