-- Evaluate the existing, statement-stable read permissions once per statement.
-- Roles, actions, write checks, helper bodies, grants and row predicates stay identical.
-- In particular, profiles is excluded: its same-table update check needs the original read policy.
do $$
declare
  expected record;
  actual record;
  original text;
  optimized text;
begin
  perform set_config('search_path','pg_catalog,public',true);
  foreach original in array array['public.can_read()', 'public.is_staff()'] loop
    if not exists (select 1 from pg_proc where oid=to_regprocedure(original) and pronargs=0 and provolatile='s') then
      raise exception 'corebiz_performance_review_required:helper:%',original;
    end if;
  end loop;
  for expected in
    select t as table_name, t||'_read_all' as policy_name, 'SELECT' as command, 'can_read()' as predicate, null::text as check_predicate
    from unnest(array['products','inventory','categories','product_groups','customers','customer_branches','warehouses','notifications']) t
    union all
    select t, t||'_staff_all', 'ALL', 'is_staff()', 'is_staff()'
    from unnest(array['products','inventory','categories','customers','warehouses']) t
  loop
    select * into actual from pg_policies where schemaname='public' and tablename=expected.table_name and policyname=expected.policy_name;
    original:=expected.predicate;
    optimized:='(select public.'||original||')';
    if not found or actual.permissive<>'PERMISSIVE' or actual.roles<>array['authenticated']::name[] or actual.cmd<>expected.command
      or regexp_replace(coalesce(actual.with_check,''),'\s+','','g')<>coalesce(expected.check_predicate,'')
      or regexp_replace(coalesce(actual.qual,''),'\s+','','g') not in (
        original, '(SELECT'||original||'AS'||split_part(original,'(',1)||')'
      ) then
      raise exception 'corebiz_performance_review_required:policy:%',expected.policy_name;
    end if;
    -- ALTER only USING. Explicit WITH CHECK on ALL stays exactly as deployed.
    execute format('alter policy %I on public.%I using (%s)',expected.policy_name,expected.table_name,optimized);
  end loop;
  -- Matches customersApi.list() exactly: avoid sorting every customer for each page.
  if to_regclass('public.customers_spent_page_idx') is null then
    execute 'create index customers_spent_page_idx on public.customers (total_spent desc, id asc)';
  elsif (select indexdef from pg_indexes where schemaname='public' and indexname='customers_spent_page_idx')
    <> 'CREATE INDEX customers_spent_page_idx ON public.customers USING btree (total_spent DESC, id)' then
    raise exception 'corebiz_performance_review_required:index';
  end if;
end $$;
