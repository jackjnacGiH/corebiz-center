-- P3: bounded unified sales page, server search/filter/counts, stable keyset.
-- Index choice is backed by the reproducible EXPLAIN fixture in the sales DB
-- tests. Constraint-owned uniqueness/foreign-key indexes are retained.
-- Live metadata verified the extra quote-code index has no dependants and
-- duplicates the constraint-owned btree. Recheck every invariant at apply time;
-- an unexpected schema stops migration instead of guessing which index to drop.
do $$
declare v_duplicate record; v_keeper record; v_code_attnum smallint;
begin
  if to_regclass('public.quotes_code_unique_idx') is null then return; end if;
  select i.*,c.relam,c.relkind into v_duplicate from pg_index i join pg_class c on c.oid=i.indexrelid
    where i.indexrelid=to_regclass('public.quotes_code_unique_idx');
  select i.*,c.relam,c.relkind into v_keeper from pg_index i join pg_class c on c.oid=i.indexrelid
    where i.indexrelid=to_regclass('public.quotes_code_key');
  if not found then raise exception 'quote_duplicate_index_review_required:keeper_missing'; end if;
  select attnum into v_code_attnum from pg_attribute where attrelid='public.quotes'::regclass and attname='code' and not attisdropped;
  if v_duplicate.indrelid<>'public.quotes'::regclass or v_keeper.indrelid<>'public.quotes'::regclass
    or v_duplicate.relkind<>'i' or v_keeper.relkind<>'i'
    or not v_duplicate.indisvalid or not v_keeper.indisvalid
    or not v_duplicate.indisready or not v_keeper.indisready
    or not v_duplicate.indislive or not v_keeper.indislive
    or not v_duplicate.indisunique or not v_keeper.indisunique
    or v_duplicate.indisreplident or v_duplicate.indisclustered
    or v_duplicate.indnatts<>1 or v_keeper.indnatts<>1 or v_duplicate.indnkeyatts<>1 or v_keeper.indnkeyatts<>1
    or v_duplicate.indkey[0] is distinct from v_code_attnum or v_keeper.indkey[0] is distinct from v_code_attnum
    or v_duplicate.indexprs is not null or v_keeper.indexprs is not null
    or v_duplicate.indpred is not null or v_keeper.indpred is not null
    or v_duplicate.relam is distinct from v_keeper.relam
    or (select amname from pg_am where oid=v_keeper.relam)<>'btree'
    or v_duplicate.indclass is distinct from v_keeper.indclass
    or v_duplicate.indcollation is distinct from v_keeper.indcollation
    or v_duplicate.indoption is distinct from v_keeper.indoption
    or v_duplicate.indnullsnotdistinct is distinct from v_keeper.indnullsnotdistinct
    or not exists(select 1 from pg_constraint where conindid=v_keeper.indexrelid and contype='u' and conrelid='public.quotes'::regclass and conkey=array[v_code_attnum])
    or exists(select 1 from pg_constraint where conindid=v_duplicate.indexrelid)
    or exists(select 1 from pg_depend where refclassid='pg_class'::regclass and refobjid=v_duplicate.indexrelid)
  then raise exception 'quote_duplicate_index_review_required:definition_or_dependency'; end if;
  execute 'drop index public.quotes_code_unique_idx';
end $$;

create index if not exists orders_created_id_page_idx on public.orders(created_at desc,id desc);
create index if not exists quotes_created_id_page_idx on public.quotes(created_at desc,id desc);

create or replace function public.list_sales_documents(
  p_limit integer default 100,p_search text default '',p_status text default 'all',p_kind text default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_cursor_kind text default null
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_items jsonb; v_counts jsonb; v_last jsonb; v_has_more boolean;
begin
  if not public.can_read() then raise exception 'forbidden'; end if;
  if p_limit is null or p_limit<1 or p_limit>200 or length(coalesce(p_search,''))>200
    or p_status not in ('all','pending','processing','shipped','delivered','cancelled','returned')
    or (p_kind is not null and p_kind not in ('order','quote'))
    or ((p_cursor_created_at is null) is distinct from (p_cursor_id is null))
    or (p_cursor_id is not null and (p_cursor_kind is null or p_cursor_kind not in ('order','quote'))) then raise exception 'invalid_sales_page'; end if;
  with all_rows as (
    select o.status bucket from public.orders o left join public.customers c on c.id=o.customer_id
      where (p_kind is null or p_kind='order') and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(o.code||' '||coalesce(c.name,'')))>0)
    union all
    select case when q.status in ('rejected','expired') then 'cancelled' else 'pending' end from public.quotes q left join public.customers c on c.id=q.customer_id
      where q.converted_to_order_id is null and (p_kind is null or p_kind='quote')
        and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(q.code||' '||coalesce(c.name,'')))>0)
  ), buckets as(select bucket,count(*) n from all_rows group by bucket)
  select coalesce(jsonb_object_agg(bucket,n),'{}'::jsonb)||jsonb_build_object('all',coalesce(sum(n),0)) into v_counts from buckets;

  with order_page as (
    select 'order'::text kind,o.id,o.created_at,
      to_jsonb(o)||jsonb_build_object(
        'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'tier',c.tier) end,
        'item_count',(select count(*) from public.order_items oi where oi.order_id=o.id)) document
    from public.orders o left join public.customers c on c.id=o.customer_id
    where (p_kind is null or p_kind='order') and (p_status='all' or o.status=p_status)
      and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(o.code||' '||coalesce(c.name,'')))>0)
      and (p_cursor_id is null or (o.created_at,o.id,'order'::text)<(p_cursor_created_at,p_cursor_id,p_cursor_kind))
    order by o.created_at desc,o.id desc limit p_limit+1
  ), quote_page as (
    select 'quote'::text kind,q.id,q.created_at,
      jsonb_build_object('id',q.id,'code',q.code,'status',q.status,'subtotal',q.subtotal,'discount',q.discount,'vat',q.vat,'total',q.total,
        'created_at',q.created_at,'version',q.version,'valid_until',q.valid_until,'notes',q.notes,'converted_to_order_id',q.converted_to_order_id,
        'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'name',c.name,'tax_id',c.tax_id,'billing_address',c.billing_address) end) document
    from public.quotes q left join public.customers c on c.id=q.customer_id
    where q.converted_to_order_id is null and (p_kind is null or p_kind='quote')
      and (p_status='all' or (case when q.status in ('rejected','expired') then 'cancelled' else 'pending' end)=p_status)
      and (coalesce(p_search,'')='' or position(lower(trim(p_search)) in lower(q.code||' '||coalesce(c.name,'')))>0)
      and (p_cursor_id is null or (q.created_at,q.id,'quote'::text)<(p_cursor_created_at,p_cursor_id,p_cursor_kind))
    order by q.created_at desc,q.id desc limit p_limit+1
  ), merged as (
    select * from order_page union all select * from quote_page
  ), limited as (
    select *,row_number() over(order by created_at desc,id desc,kind desc) rn from merged
    order by created_at desc,id desc,kind desc limit p_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'document',document) order by rn) filter(where rn<=p_limit),'[]'::jsonb),
    count(*)>p_limit,(jsonb_agg(jsonb_build_object('created_at',created_at,'id',id,'kind',kind) order by rn desc) filter(where rn=p_limit))->0
    into v_items,v_has_more,v_last from limited;
  return jsonb_build_object('items',v_items,'counts',v_counts,'next_cursor',case when v_has_more then v_last else null end);
end $$;
revoke all on function public.list_sales_documents(integer,text,text,text,timestamptz,uuid,text) from public,anon;
grant execute on function public.list_sales_documents(integer,text,text,text,timestamptz,uuid,text) to authenticated;
