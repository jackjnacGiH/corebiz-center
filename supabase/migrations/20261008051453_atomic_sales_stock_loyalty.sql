-- F07-F10/F12: atomic sales writes, optimistic versions, exact stock ledger,
-- single-winner loyalty and customer quote responses. No historical balances
-- are changed. Existing orders require an owner-reviewed stock baseline before
-- changing their stock demand or cancelling. Deploy the migration before UI.

alter table public.orders add column if not exists version bigint not null default 1;
alter table public.quotes add column if not exists version bigint not null default 1;
-- PostgreSQL retains the original zero default for existing rows; only orders
-- inserted after this migration inherit version 1. Do not guess old deductions.
alter table public.orders add column if not exists stock_ledger_version smallint not null default 0;
alter table public.orders alter column stock_ledger_version set default 1;
alter table public.orders add column if not exists stock_warehouse_id uuid references public.warehouses(id);
alter table public.orders add column if not exists source_quote_id uuid references public.quotes(id);
create unique index if not exists orders_source_quote_once_idx on public.orders(source_quote_id) where source_quote_id is not null;

-- NULL variant_id was not protected by the original ordinary UNIQUE key.
-- This safe preflight refuses migration rather than deleting ambiguous stock.
do $$ begin
  if exists(select 1 from public.inventory group by product_id,variant_id,warehouse_id having count(*)>1) then
    raise exception 'inventory_duplicate_rows_review_required';
  end if;
  if exists(select 1 from public.loyalty_transactions where reference_type='order' and reason='earn_order'
            and reference_id is not null group by reference_id having count(*)>1) then
    raise exception 'loyalty_duplicate_awards_review_required';
  end if;
end $$;
create unique index if not exists inventory_product_variant_warehouse_once_idx
  on public.inventory(product_id,variant_id,warehouse_id) nulls not distinct;
create unique index if not exists loyalty_earn_order_once_idx on public.loyalty_transactions(reference_id)
  where reference_type='order' and reason='earn_order' and reference_id is not null;

create table if not exists public.order_stock_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  variant_id uuid references public.product_variants(id),
  warehouse_id uuid not null references public.warehouses(id),
  requested integer not null check(requested>=0),
  deducted integer not null check(deducted>=0 and deducted<=requested),
  backorder integer generated always as (requested-deducted) stored,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  unique nulls not distinct(order_id,product_id,variant_id)
);
alter table public.order_stock_allocations enable row level security;
revoke all on public.order_stock_allocations from anon,authenticated;
grant select on public.order_stock_allocations to authenticated;
grant all on public.order_stock_allocations to service_role;
drop policy if exists order_stock_allocations_read on public.order_stock_allocations;
create policy order_stock_allocations_read on public.order_stock_allocations for select to authenticated using(public.is_staff());
alter table public.inventory_movements add column if not exists ledger_key text;
create unique index if not exists inventory_movement_ledger_once_idx on public.inventory_movements(ledger_key) where ledger_key is not null;
create table if not exists public.sales_document_revisions (
  document_type text not null check(document_type in ('quote','order')),
  document_id uuid not null,
  version bigint not null,
  header_snapshot jsonb not null,
  items_snapshot jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now(),
  primary key(document_type,document_id,version)
);
alter table public.sales_document_revisions enable row level security;
revoke all on public.sales_document_revisions from anon,authenticated;
grant select on public.sales_document_revisions to authenticated;
grant all on public.sales_document_revisions to service_role;
drop policy if exists sales_document_revisions_read on public.sales_document_revisions;
create policy sales_document_revisions_read on public.sales_document_revisions for select to authenticated using(public.is_staff());

create or replace function public.tg_sales_document_version() returns trigger
language plpgsql set search_path=public as $$ begin
  NEW.version:=OLD.version+1;
  return NEW;
end $$;
drop trigger if exists sales_order_version on public.orders;
create trigger sales_order_version before update on public.orders for each row execute function public.tg_sales_document_version();
drop trigger if exists sales_quote_version on public.quotes;
create trigger sales_quote_version before update on public.quotes for each row execute function public.tg_sales_document_version();

-- Every line mutation locks its parent before touching the row. Direct writes
-- also invalidate open editors; privileged RPCs never bypass this version.
create or replace function public.tg_sales_item_parent() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_legacy boolean; v_status text;
begin
  if TG_TABLE_NAME='order_items' then
    v_id:=case when TG_OP='DELETE' then OLD.order_id else NEW.order_id end;
    if TG_OP='UPDATE' and NEW.order_id is distinct from OLD.order_id then raise exception 'item_parent_immutable'; end if;
    select stock_ledger_version=0,status into v_legacy,v_status from public.orders where id=v_id for update;
    if v_legacy and v_status in ('processing','shipped','delivered') then raise exception 'stock_legacy_review_required'; end if;
    if TG_WHEN='AFTER' then update public.orders set updated_at=now() where id=v_id; end if;
  else
    v_id:=case when TG_OP='DELETE' then OLD.quote_id else NEW.quote_id end;
    if TG_OP='UPDATE' and NEW.quote_id is distinct from OLD.quote_id then raise exception 'item_parent_immutable'; end if;
    perform 1 from public.quotes where id=v_id for update;
    if TG_WHEN='AFTER' then update public.quotes set updated_at=now() where id=v_id; end if;
  end if;
  return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
drop trigger if exists sales_order_item_lock on public.order_items;
create trigger sales_order_item_lock before insert or update or delete on public.order_items for each row execute function public.tg_sales_item_parent();
drop trigger if exists sales_order_item_version on public.order_items;
create trigger sales_order_item_version after insert or update or delete on public.order_items for each row execute function public.tg_sales_item_parent();
drop trigger if exists sales_quote_item_lock on public.quote_items;
create trigger sales_quote_item_lock before insert or update or delete on public.quote_items for each row execute function public.tg_sales_item_parent();
drop trigger if exists sales_quote_item_version on public.quote_items;
create trigger sales_quote_item_version after insert or update or delete on public.quote_items for each row execute function public.tg_sales_item_parent();

create or replace function public.reconcile_order_inventory(p_order_id uuid,p_release boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_warehouse uuid; v_count integer; v_item record;
  v_old_requested integer; v_old_deducted integer; v_new_deducted integer;
  v_revision bigint; v_stock integer; v_delta integer; v_inventory_id uuid;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.stock_ledger_version=0 then return; end if;
  if exists(select 1 from public.order_items oi left join public.product_variants pv on pv.id=oi.variant_id
    where oi.order_id=p_order_id and oi.variant_id is not null and pv.product_id is distinct from oi.product_id) then raise exception 'invalid_item_product_variant'; end if;
  v_warehouse:=v_order.stock_warehouse_id;
  if v_warehouse is null then
    select count(*),(array_agg(id order by id))[1] into v_count,v_warehouse from public.warehouses where is_default;
    if v_count<>1 then raise exception 'default_warehouse_required'; end if;
    update public.orders set stock_warehouse_id=v_warehouse where id=p_order_id;
  end if;
  -- Stable product/variant lock order prevents two multi-SKU orders deadlocking.
  for v_item in
    with demand as (
      select product_id,variant_id,sum(quantity)::integer requested from public.order_items
      where order_id=p_order_id and product_id is not null and not p_release
        and v_order.status in ('processing','shipped','delivered') group by product_id,variant_id
    )
    select coalesce(d.product_id,a.product_id) product_id,coalesce(d.variant_id,a.variant_id) variant_id,
           coalesce(d.requested,0) requested
    from demand d full join (select * from public.order_stock_allocations where order_id=p_order_id) a
      on d.product_id=a.product_id and d.variant_id is not distinct from a.variant_id
    order by 1,2 nulls first
  loop
    select requested,deducted,revision into v_old_requested,v_old_deducted,v_revision
      from public.order_stock_allocations where order_id=p_order_id and product_id=v_item.product_id
        and variant_id is not distinct from v_item.variant_id;
    v_old_requested:=coalesce(v_old_requested,0); v_old_deducted:=coalesce(v_old_deducted,0); v_revision:=coalesce(v_revision,0)+1;
    if v_item.requested=v_old_requested then continue; end if;
    insert into public.inventory(product_id,variant_id,warehouse_id,quantity)
      values(v_item.product_id,v_item.variant_id,v_warehouse,0)
      on conflict(product_id,variant_id,warehouse_id) do nothing;
    select id,greatest(0,quantity-reserved) into v_inventory_id,v_stock from public.inventory
      where product_id=v_item.product_id and variant_id is not distinct from v_item.variant_id and warehouse_id=v_warehouse for update;
    v_new_deducted:=least(v_old_deducted,v_item.requested);
    if v_item.requested>v_old_requested then
      v_new_deducted:=v_new_deducted+least(v_item.requested-v_old_requested,v_stock);
    end if;
    v_delta:=v_old_deducted-v_new_deducted;
    if v_delta<>0 then
      update public.inventory set quantity=quantity+v_delta where id=v_inventory_id;
      insert into public.inventory_movements(product_id,variant_id,warehouse_id,movement_type,quantity,reference_type,reference_id,note,created_by,ledger_key)
      values(v_item.product_id,v_item.variant_id,v_warehouse,case when v_delta<0 then 'out' else 'in' end,v_delta,
        case when v_delta<0 then 'order' else 'order_return' end,p_order_id,'Stock ledger: '||v_order.code,auth.uid(),
        p_order_id::text||':'||v_item.product_id::text||':'||coalesce(v_item.variant_id::text,'base')||':'||v_revision::text);
    end if;
    insert into public.order_stock_allocations(order_id,product_id,variant_id,warehouse_id,requested,deducted,revision)
      values(p_order_id,v_item.product_id,v_item.variant_id,v_warehouse,v_item.requested,v_new_deducted,v_revision)
      on conflict(order_id,product_id,variant_id) do update
      set requested=excluded.requested,deducted=excluded.deducted,revision=excluded.revision,updated_at=now();
  end loop;
end $$;

-- Deferred reconciliation sees the final set of lines, never the temporary
-- empty document between delete/insert in an atomic replacement.
create or replace function public.tg_order_stock_reconcile() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if TG_TABLE_NAME='order_items' then
    perform public.reconcile_order_inventory(case when TG_OP='DELETE' then OLD.order_id else NEW.order_id end);
  else perform public.reconcile_order_inventory(NEW.id); end if;
  return null;
end $$;
create or replace function public.tg_order_stock_legacy_guard() returns trigger
language plpgsql set search_path=public as $$ begin
  if current_user not in ('postgres','supabase_admin','service_role') then
    if TG_OP='INSERT' and (NEW.stock_ledger_version<>1 or NEW.stock_warehouse_id is not null or NEW.source_quote_id is not null) then raise exception 'stock_metadata_managed_by_server'; end if;
    if TG_OP='UPDATE' and (NEW.stock_ledger_version is distinct from OLD.stock_ledger_version
      or NEW.stock_warehouse_id is distinct from OLD.stock_warehouse_id or NEW.source_quote_id is distinct from OLD.source_quote_id) then raise exception 'stock_metadata_managed_by_server'; end if;
  end if;
  if TG_OP='INSERT' then return NEW; end if;
  if OLD.stock_ledger_version=0 and NEW.stock_ledger_version=0
    and (NEW.status in ('processing','shipped','delivered')) is distinct from (OLD.status in ('processing','shipped','delivered')) then
    raise exception 'stock_legacy_review_required';
  end if;
  return NEW;
end $$;
create or replace function public.tg_order_stock_delete() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if OLD.stock_ledger_version=0 and OLD.status in ('processing','shipped','delivered') then raise exception 'stock_legacy_review_required'; end if;
  perform public.reconcile_order_inventory(OLD.id,true);
  return OLD;
end $$;
drop trigger if exists order_status_inventory_trigger on public.orders;
drop trigger if exists order_stock_legacy_guard on public.orders;
create trigger order_stock_legacy_guard before insert or update on public.orders for each row execute function public.tg_order_stock_legacy_guard();
drop trigger if exists order_stock_delete on public.orders;
create trigger order_stock_delete before delete on public.orders for each row execute function public.tg_order_stock_delete();
drop trigger if exists order_stock_reconcile on public.orders;
create constraint trigger order_stock_reconcile after insert or update on public.orders deferrable initially deferred for each row execute function public.tg_order_stock_reconcile();
drop trigger if exists order_item_stock_reconcile on public.order_items;
create constraint trigger order_item_stock_reconcile after insert or update or delete on public.order_items deferrable initially deferred for each row execute function public.tg_order_stock_reconcile();

create or replace function public.baseline_order_stock(p_order_id uuid,p_allocations jsonb,p_note text,p_expected_version bigint,p_warehouse_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_warehouse uuid; v_count integer; v_item record; v_amount integer;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','admin')) then raise exception 'forbidden'; end if;
  if length(trim(coalesce(p_note,'')))<10 or jsonb_typeof(p_allocations) is distinct from 'array' then raise exception 'review_note_and_allocations_required'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'not_found'; end if;
  if p_expected_version is null or p_expected_version<>v_order.version then raise exception 'document_version_conflict'; end if;
  if v_order.stock_ledger_version<>0 then raise exception 'already_baselined'; end if;
  if p_warehouse_id is not null then
    if not exists(select 1 from public.warehouses where id=p_warehouse_id) then raise exception 'warehouse_not_found'; end if;
    v_warehouse:=p_warehouse_id;
  else
    select count(*),(array_agg(id order by id))[1] into v_count,v_warehouse from public.warehouses where is_default;
    if v_count<>1 then raise exception 'default_warehouse_required'; end if;
  end if;
  if (select count(*) from jsonb_array_elements(p_allocations))<>(select count(*) from (
    select product_id,variant_id from public.order_items where order_id=p_order_id and product_id is not null group by 1,2) d) then raise exception 'baseline_items_mismatch'; end if;
  for v_item in select product_id,variant_id,sum(quantity)::integer requested from public.order_items
    where order_id=p_order_id and product_id is not null group by 1,2
  loop
    select count(*),max(x.deducted) into v_count,v_amount from jsonb_to_recordset(p_allocations) as x(product_id uuid,variant_id uuid,deducted integer)
      where x.product_id=v_item.product_id and x.variant_id is not distinct from v_item.variant_id;
    if v_count<>1 or v_amount is null or v_amount<0 or v_amount>v_item.requested then raise exception 'invalid_baseline_deduction'; end if;
    if v_order.status not in ('processing','shipped','delivered') and v_amount<>0 then raise exception 'inactive_baseline_must_be_zero'; end if;
    insert into public.order_stock_allocations(order_id,product_id,variant_id,warehouse_id,requested,deducted)
      values(p_order_id,v_item.product_id,v_item.variant_id,v_warehouse,
        case when v_order.status in ('processing','shipped','delivered') then v_item.requested else 0 end,v_amount);
  end loop;
  update public.orders set stock_ledger_version=1,stock_warehouse_id=v_warehouse where id=p_order_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'order.stock_baseline','order',p_order_id::text,jsonb_build_object('note',p_note,'allocations',p_allocations,'warehouse_id',v_warehouse));
end $$;

create or replace function public.sales_stock_review_queue() returns table(order_id uuid,order_code text,status text,version bigint,item_count bigint)
language plpgsql stable security definer set search_path=public as $$ begin
  if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','admin')) then raise exception 'forbidden'; end if;
  return query select o.id,o.code,o.status,o.version,count(oi.id) from public.orders o left join public.order_items oi on oi.order_id=o.id
    where o.stock_ledger_version=0 group by o.id order by o.created_at,o.id;
end $$;

-- Validated totals use header-only discount, matching the existing schema.
create or replace function public.sales_items_subtotal(p_items jsonb) returns numeric
language plpgsql immutable set search_path=public as $$
declare v_line record; v_subtotal numeric:=0; v_gross numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>1000 then raise exception 'invalid_items'; end if;
  for v_line in select * from jsonb_to_recordset(p_items) as x(sku text,product_name text,quantity numeric,unit_price numeric,discount numeric)
  loop
    if nullif(trim(v_line.sku),'') is null or nullif(trim(v_line.product_name),'') is null
      or v_line.quantity is null or v_line.quantity<=0 or v_line.quantity>2147483647 or v_line.quantity<>trunc(v_line.quantity)
      or v_line.unit_price is null or v_line.unit_price<0 or v_line.unit_price>=10000000000
      or coalesce(v_line.discount,0)<0 or coalesce(v_line.discount,0)>=10000000000 then raise exception 'invalid_item_value'; end if;
    v_gross:=round(v_line.unit_price,2)*v_line.quantity;
    if coalesce(v_line.discount,0)>v_gross then raise exception 'line_discount_exceeds_total'; end if;
    v_subtotal:=v_subtotal+v_gross-round(coalesce(v_line.discount,0),2);
  end loop;
  if v_subtotal>=1000000000000 then raise exception 'document_total_too_large'; end if;
  return v_subtotal;
end $$;

create or replace function public.create_sales_quote(p_items jsonb,p_customer_id uuid default null,p_discount numeric default 0,
  p_vat_rate numeric default 0.07,p_valid_days integer default 30,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_subtotal numeric; v_vat numeric; v_quote public.quotes%rowtype;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  v_subtotal:=public.sales_items_subtotal(p_items);
  if p_discount is null or p_discount<0 or p_discount>v_subtotal or p_vat_rate is null or p_vat_rate<0 or p_vat_rate>1
    or p_valid_days is null or p_valid_days<1 or p_valid_days>365 then raise exception 'invalid_document_value'; end if;
  v_vat:=round((v_subtotal-round(p_discount,2))*p_vat_rate,2);
  insert into public.quotes(customer_id,status,subtotal,discount,vat,total,valid_until,notes,created_by)
    values(p_customer_id,'draft',v_subtotal,round(p_discount,2),v_vat,v_subtotal-round(p_discount,2)+v_vat,
      (now() at time zone 'Asia/Bangkok')::date+p_valid_days,p_notes,auth.uid()) returning * into v_quote;
  insert into public.quote_items(quote_id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total)
    select v_quote.id,x.product_id,x.variant_id,x.sku,x.product_name,x.quantity,round(x.unit_price,2),x.unit,
      round(coalesce(x.discount,0),2),round(x.unit_price,2)*x.quantity-round(coalesce(x.discount,0),2)
      from jsonb_to_recordset(p_items) as x(product_id uuid,variant_id uuid,sku text,product_name text,quantity integer,unit_price numeric,unit text,discount numeric);
  return jsonb_build_object('id',v_quote.id,'code',v_quote.code);
end $$;

-- The storefront Edge resolves prices and MOQ before this service-only RPC.
-- Applying shipping inside the same transaction prevents partial draft quotes.
create or replace function public.create_storefront_quote_atomic(p_items jsonb,p_customer_id uuid default null,p_discount numeric default 0,
  p_vat_rate numeric default 0.07,p_valid_days integer default 30,p_notes text default null,p_created_by uuid default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_subtotal numeric; v_vat numeric; v_quote public.quotes%rowtype;
begin
  v_subtotal:=public.sales_items_subtotal(p_items);
  if p_discount is null or p_discount<0 or p_discount>v_subtotal or p_vat_rate is null or p_vat_rate<0 or p_vat_rate>1
    or p_valid_days is null or p_valid_days<1 or p_valid_days>365 then raise exception 'invalid_document_value'; end if;
  v_vat:=round((v_subtotal-round(p_discount,2))*p_vat_rate,2);
  insert into public.quotes(customer_id,status,subtotal,discount,vat,total,valid_until,notes,created_by)
    values(p_customer_id,'draft',v_subtotal,round(p_discount,2),v_vat,v_subtotal-round(p_discount,2)+v_vat,
      (now() at time zone 'Asia/Bangkok')::date+p_valid_days,p_notes,p_created_by) returning * into v_quote;
  insert into public.quote_items(quote_id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total)
    select v_quote.id,x.product_id,x.variant_id,x.sku,x.product_name,x.quantity,round(x.unit_price,2),x.unit,
      round(coalesce(x.discount,0),2),round(x.unit_price,2)*x.quantity-round(coalesce(x.discount,0),2)
      from jsonb_to_recordset(p_items) as x(product_id uuid,variant_id uuid,sku text,product_name text,quantity integer,unit_price numeric,unit text,discount numeric);
  perform public.apply_quote_shipping(v_quote.id);
  return jsonb_build_object('id',v_quote.id,'code',v_quote.code);
end $$;

create or replace function public.replace_sales_document_items(p_kind text,p_id uuid,p_items jsonb,p_discount numeric,
  p_shipping_fee numeric,p_expected_version bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare v_version bigint; v_subtotal numeric; v_vat numeric; v_existing jsonb; v_converted uuid;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if p_kind='quote' then
    select version,converted_to_order_id into v_version,v_converted from public.quotes where id=p_id for update;
    if v_converted is not null then raise exception 'converted_quote_cannot_edit'; end if;
  elsif p_kind='order' then select version into v_version from public.orders where id=p_id for update;
  else raise exception 'invalid_document_kind'; end if;
  if v_version is null then raise exception 'not_found'; end if;
  if p_expected_version is null or p_expected_version<>v_version then raise exception 'document_version_conflict'; end if;
  v_subtotal:=public.sales_items_subtotal(p_items);
  if p_discount is null or p_discount<0 or p_discount>v_subtotal or p_shipping_fee is null or p_shipping_fee<0 or p_shipping_fee>=1000000000000 then raise exception 'invalid_document_value'; end if;
  v_vat:=round((v_subtotal-round(p_discount,2))*0.07,2);
  if p_kind='quote' then
    -- Preserve authoritative pricing provenance for unchanged line identity.
    select coalesce(jsonb_agg(to_jsonb(qi)),'[]'::jsonb) into v_existing from public.quote_items qi where quote_id=p_id;
    insert into public.sales_document_revisions(document_type,document_id,version,header_snapshot,items_snapshot,actor_id)
      select 'quote',p_id,v_version,to_jsonb(q),v_existing,auth.uid() from public.quotes q where id=p_id;
    delete from public.quote_items where quote_id=p_id;
    insert into public.quote_items(quote_id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total,
      base_unit_price,price_source,tier_percent,net_rule_id,pricing_snapshot,price_fingerprint,price_resolved_at)
    select p_id,x.product_id,x.variant_id,x.sku,x.product_name,x.quantity,round(x.unit_price,2),x.unit,round(coalesce(x.discount,0),2),
      round(x.unit_price,2)*x.quantity-round(coalesce(x.discount,0),2),
      case when match.unchanged then old.base_unit_price end,case when match.unchanged then coalesce(old.price_source,'manual') else 'manual' end,
      case when match.unchanged then old.tier_percent end,case when match.unchanged then old.net_rule_id end,
      case when match.unchanged then old.pricing_snapshot end,case when match.unchanged then old.price_fingerprint end,
      case when match.unchanged then old.price_resolved_at end
    from jsonb_to_recordset(p_items) as x(id uuid,product_id uuid,variant_id uuid,sku text,product_name text,quantity integer,unit_price numeric,unit text,discount numeric)
    left join jsonb_to_recordset(v_existing) as old(id uuid,product_id uuid,variant_id uuid,sku text,quantity integer,unit_price numeric,discount numeric,base_unit_price numeric,
      price_source text,tier_percent numeric,net_rule_id uuid,pricing_snapshot jsonb,price_fingerprint text,price_resolved_at timestamptz) on old.id=x.id
    cross join lateral(select old.product_id is not distinct from x.product_id and old.variant_id is not distinct from x.variant_id
      and old.sku=x.sku and old.unit_price=x.unit_price and old.quantity=x.quantity and coalesce(old.discount,0)=coalesce(x.discount,0) as unchanged) match;
    update public.quotes set subtotal=v_subtotal,discount=round(p_discount,2),vat=v_vat,total=v_subtotal-round(p_discount,2)+v_vat where id=p_id returning version into v_version;
  else
    insert into public.sales_document_revisions(document_type,document_id,version,header_snapshot,items_snapshot,actor_id)
      select 'order',p_id,v_version,to_jsonb(o),coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where order_id=p_id),'[]'::jsonb),auth.uid()
      from public.orders o where id=p_id;
    delete from public.order_items where order_id=p_id;
    insert into public.order_items(order_id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total)
      select p_id,x.product_id,x.variant_id,x.sku,x.product_name,x.quantity,round(x.unit_price,2),x.unit,round(coalesce(x.discount,0),2),
        round(x.unit_price,2)*x.quantity-round(coalesce(x.discount,0),2)
        from jsonb_to_recordset(p_items) as x(product_id uuid,variant_id uuid,sku text,product_name text,quantity integer,unit_price numeric,unit text,discount numeric);
    update public.orders set subtotal=v_subtotal,discount=round(p_discount,2),vat=v_vat,shipping_fee=round(p_shipping_fee,2),
      total=v_subtotal-round(p_discount,2)+v_vat+round(p_shipping_fee,2) where id=p_id returning version into v_version;
    perform public.reconcile_order_inventory(p_id);
    select version into v_version from public.orders where id=p_id;
  end if;
  return v_version;
end $$;

create or replace function public.approve_quote_as_order(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_quote public.quotes%rowtype; v_order public.orders%rowtype; v_code text; v_subtotal numeric;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  select * into v_quote from public.quotes where id=p_quote_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_quote.converted_to_order_id is not null then
    select * into v_order from public.orders where id=v_quote.converted_to_order_id;
    if not found then raise exception 'linked_order_missing_review_required'; end if;
    return jsonb_build_object('id',v_order.id,'code',v_order.code);
  end if;
  if v_quote.status not in ('draft','sent','accepted') then raise exception 'quote_not_actionable:%',v_quote.status; end if;
  if not exists(select 1 from public.quote_items where quote_id=p_quote_id) then raise exception 'quote_items_required'; end if;
  select public.sales_items_subtotal(jsonb_agg(to_jsonb(qi))) into v_subtotal from public.quote_items qi where quote_id=p_quote_id;
  if v_quote.subtotal<>v_subtotal or v_quote.discount<0 or v_quote.discount>v_subtotal or v_quote.vat<0
    or v_quote.total<>round(v_subtotal-v_quote.discount+v_quote.vat,2) then raise exception 'quote_totals_review_required'; end if;
  v_code:=case when left(v_quote.code,3)='QT-' then 'SO-'||substr(v_quote.code,4) else 'SO-'||v_quote.code end;
  if exists(select 1 from public.orders where code=v_code and source_quote_id is distinct from p_quote_id) then raise exception 'legacy_order_code_collision_review_required'; end if;
  insert into public.orders(code,customer_id,status,payment_status,subtotal,discount,vat,total,notes,created_by,source_quote_id)
    values(v_code,v_quote.customer_id,'pending','unpaid',v_quote.subtotal,v_quote.discount,v_quote.vat,v_quote.total,v_quote.notes,auth.uid(),p_quote_id)
    returning * into v_order;
  insert into public.order_items(order_id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total)
    select v_order.id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total from public.quote_items where quote_id=p_quote_id;
  update public.orders set status='processing' where id=v_order.id;
  perform public.reconcile_order_inventory(v_order.id);
  update public.quotes set status='accepted',converted_to_order_id=v_order.id where id=p_quote_id;
  insert into public.audit_logs(actor_id,action,target_type,target_id,detail)
    values(auth.uid(),'quote.approve_order','quote',p_quote_id::text,jsonb_build_object('order_id',v_order.id,'order_code',v_code));
  return jsonb_build_object('id',v_order.id,'code',v_code);
end $$;

-- Quote response and its task/audit commit together under the same row lock.
create or replace function public.respond_my_quote(p_quote_id uuid,p_accept boolean) returns text
language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_cust uuid; v_quote public.quotes%rowtype; v_new text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and is_active) then raise exception 'forbidden'; end if;
  if p_accept is null then raise exception 'invalid_response'; end if;
  v_cust:=public.my_customer_id();
  if v_cust is null then raise exception 'not_linked'; end if;
  select * into v_quote from public.quotes where id=p_quote_id and customer_id=v_cust for update;
  if not found then raise exception 'not_found'; end if;
  v_new:=case when p_accept then 'accepted' else 'rejected' end;
  if v_quote.status=v_new then return v_new; end if;
  if v_quote.status not in ('draft','sent') then raise exception 'not_actionable:%',v_quote.status; end if;
  update public.quotes set status=v_new where id=p_quote_id;
  insert into public.agent_tasks(category,kind,action_kind,title,summary,recommendation,payload,status,requires_approval,priority,related_type,related_id,dedupe_key,source)
  values('sales','sales.quote_response','none',case when p_accept then '✅ ลูกค้าตอบรับใบเสนอราคา ' else '❌ ลูกค้าปฏิเสธใบเสนอราคา ' end||v_quote.code,
    'ลูกค้าตอบจากหน้า บัญชีของฉัน · ยอดสุทธิ '||v_quote.total::text||' บาท',
    case when p_accept then 'เปิดใบเสนอราคาแล้วอนุมัติสร้างคำสั่งซื้อ จากนั้นยืนยันการจัดส่ง/ชำระเงินกับลูกค้า' else 'ติดต่อลูกค้าเพื่อสอบถามเหตุผล/เสนอเงื่อนไขใหม่' end,
    jsonb_build_object('quote_id',p_quote_id,'quote_code',v_quote.code,'accepted',p_accept,'user_id',v_uid,'customer_id',v_cust),
    'proposed',true,case when p_accept then 1 else 2 end,'quote',p_quote_id::text,'quote_response:'||p_quote_id::text,'portal')
    on conflict(dedupe_key) do nothing;
  insert into public.audit_logs(actor_id,action,target_type,target_id,detail)
    values(v_uid,case when p_accept then 'quote.customer_accepted' else 'quote.customer_rejected' end,'quote',p_quote_id::text,jsonb_build_object('code',v_quote.code,'customer_id',v_cust));
  return v_new;
end $$;

-- One authoritative tier-multiplied award; revoked/cancelled orders cannot earn.
-- Reversal is exact and once-only. Boss jack approved negative balances when
-- points were spent; subsequent earnings offset the debt. Historical balances
-- and awards are never rewritten by this migration.
create unique index if not exists loyalty_reverse_order_once_idx on public.loyalty_transactions(reference_id)
  where reference_type='order_reversal' and reason='adjust' and reference_id is not null;
create or replace function public.tg_order_paid_grant_points() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_tier text; v_mult numeric; v_pts integer; v_customer uuid;
begin
  if NEW.status='cancelled' or NEW.payment_status='refunded' then
    select customer_id,points into v_customer,v_pts from public.loyalty_transactions
      where reference_type='order' and reference_id=NEW.id and reason='earn_order';
    if found then
      insert into public.loyalty_transactions(customer_id,points,reason,note,reference_type,reference_id)
      values(v_customer,-v_pts,'adjust','คืนแต้มจากออเดอร์ '||NEW.code,'order_reversal',NEW.id)
      on conflict(reference_id) where reference_type='order_reversal' and reason='adjust' and reference_id is not null do nothing;
      if found then update public.customers set loyalty_points=loyalty_points-v_pts where id=v_customer; end if;
    end if;
  elsif NEW.customer_id is not null and NEW.payment_status='paid' and NEW.status<>'returned' and NEW.total>0 then
    if not exists(select 1 from public.loyalty_transactions where reference_type='order_reversal' and reference_id=NEW.id and reason='adjust') then
      select tier into v_tier from public.customers where id=NEW.customer_id;
      select point_multiplier into v_mult from public.tier_benefits where tier=v_tier;
      v_mult:=coalesce(v_mult,1); v_pts:=floor(floor(NEW.total/100.0)*v_mult);
      if v_pts>0 then
        insert into public.loyalty_transactions(customer_id,points,reason,note,reference_type,reference_id)
          values(NEW.customer_id,v_pts,'earn_order','แต้มจากออเดอร์ '||NEW.code||' (x'||v_mult||')','order',NEW.id)
          on conflict(reference_id) where reference_type='order' and reason='earn_order' and reference_id is not null do nothing;
        if found then update public.customers set loyalty_points=loyalty_points+v_pts where id=NEW.customer_id; end if;
      end if;
    end if;
  end if;
  if NEW.customer_id is not null then perform public.recalculate_customer_totals(NEW.customer_id); end if;
  if TG_OP='UPDATE' and OLD.customer_id is distinct from NEW.customer_id and OLD.customer_id is not null then perform public.recalculate_customer_totals(OLD.customer_id); end if;
  return NEW;
end $$;
drop trigger if exists order_paid_loyalty_trigger on public.orders;
drop trigger if exists order_paid_grant_points on public.orders;
create trigger order_paid_grant_points after insert or update of payment_status,status,customer_id,total on public.orders for each row execute function public.tg_order_paid_grant_points();

-- Internal helpers are not RPC endpoints. Trigger functions run only by PG.
revoke all on function public.tg_sales_document_version(),public.tg_sales_item_parent(),public.reconcile_order_inventory(uuid,boolean),
  public.tg_order_stock_reconcile(),public.tg_order_stock_legacy_guard(),public.tg_order_stock_delete(),public.sales_items_subtotal(jsonb),public.tg_order_paid_grant_points()
  from public,anon,authenticated;
revoke all on function public.baseline_order_stock(uuid,jsonb,text,bigint,uuid),public.create_sales_quote(jsonb,uuid,numeric,numeric,integer,text),
  public.replace_sales_document_items(text,uuid,jsonb,numeric,numeric,bigint),public.approve_quote_as_order(uuid),public.respond_my_quote(uuid,boolean),public.sales_stock_review_queue() from public,anon;
grant execute on function public.baseline_order_stock(uuid,jsonb,text,bigint,uuid),public.create_sales_quote(jsonb,uuid,numeric,numeric,integer,text),
  public.replace_sales_document_items(text,uuid,jsonb,numeric,numeric,bigint),public.approve_quote_as_order(uuid),public.respond_my_quote(uuid,boolean),public.sales_stock_review_queue() to authenticated;
revoke all on function public.create_storefront_quote_atomic(jsonb,uuid,numeric,numeric,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.create_storefront_quote_atomic(jsonb,uuid,numeric,numeric,integer,text,uuid) to service_role;
-- Shipping is internal to server-owned quote creation. A customer must not
-- mutate another quote by calling this existing definer function directly.
revoke all on function public.apply_quote_shipping(uuid,numeric) from public,anon,authenticated;
grant execute on function public.apply_quote_shipping(uuid,numeric) to service_role;
