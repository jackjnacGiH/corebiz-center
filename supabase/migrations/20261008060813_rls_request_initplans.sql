-- P3: cache statement-wide identity/role checks in seven of the eight policies
-- verified from live pg_policies on 2026-10-08. ALTER POLICY preserves action,
-- role, permissive mode, grants and all row/ownership conditions. The security
-- migration's profile identity trigger remains authoritative and untouched.
-- Any unexpected policy shape stops the entire migration for review.
-- Exception: profiles_self_read must remain without scalar sublinks. The
-- profiles_self_update role lookup reads this same table; adding an InitPlan
-- to its read policy makes PostgreSQL reject profile UPDATE with 42P17. The
-- targeted regression/equivalence tests prove this interaction. No new role
-- helper or removal of the existing role check is introduced to hide it.
do $$
declare v_expected record; v_actual record; v_using text; v_check text;
  v_wrapper_pattern text:='\(SELECT((auth\.uid|is_staff|shipping_private\.can_manage)\(\))AS[a-z_]+\)';
begin
  perform set_config('search_path','pg_catalog,public',true);
  if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.uid()') and pronargs=0 and provolatile='s')
    or not exists(select 1 from pg_proc where oid=to_regprocedure('public.is_staff()') and pronargs=0 and provolatile='s')
    or not exists(select 1 from pg_proc where oid=to_regprocedure('shipping_private.can_manage()') and pronargs=0 and provolatile='s') then
    raise exception 'rls_initplan_review_required:request_helper_changed';
  end if;
  for v_expected in select * from (values
    ('profiles','profiles_self_read','SELECT',
      $expr$((id = auth.uid()) OR is_staff())$expr$,null::text,
      $expr$((id = auth.uid()) OR is_staff())$expr$,null::text),
    ('profiles','profiles_self_update','UPDATE',
      $expr$(id = auth.uid())$expr$,
      $expr$((id = auth.uid()) AND (role = ( SELECT profiles_1.role FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid()))))$expr$,
      $expr$(id = (select auth.uid()))$expr$,
      $expr$((id = (select auth.uid())) AND (role = (select profiles_1.role from public.profiles profiles_1 where profiles_1.id = (select auth.uid()))))$expr$),
    ('agents','agents_self_read','SELECT',
      $expr$(user_id = auth.uid())$expr$,null::text,
      $expr$(user_id = (select auth.uid()))$expr$,null::text),
    ('agent_links','agent_links_self_read','SELECT',
      $expr$(agent_id IN ( SELECT agents.id FROM agents WHERE (agents.user_id = auth.uid())))$expr$,null::text,
      $expr$(agent_id in (select agents.id from public.agents where agents.user_id = (select auth.uid())))$expr$,null::text),
    ('commissions','commissions_self_read','SELECT',
      $expr$(agent_id IN ( SELECT agents.id FROM agents WHERE (agents.user_id = auth.uid())))$expr$,null::text,
      $expr$(agent_id in (select agents.id from public.agents where agents.user_id = (select auth.uid())))$expr$,null::text),
    ('notifications','Staff can view their notifications','SELECT',
      $expr$(is_staff() AND ((recipient_id IS NULL) OR (recipient_id = auth.uid())))$expr$,null::text,
      $expr$((select public.is_staff()) AND ((recipient_id IS NULL) OR (recipient_id = (select auth.uid()))))$expr$,null::text),
    ('notifications','Staff can mark notifications read','UPDATE',
      $expr$(is_staff() AND ((recipient_id IS NULL) OR (recipient_id = auth.uid())))$expr$,
      $expr$(is_staff() AND ((recipient_id IS NULL) OR (recipient_id = auth.uid())))$expr$,
      $expr$((select public.is_staff()) AND ((recipient_id IS NULL) OR (recipient_id = (select auth.uid()))))$expr$,
      $expr$((select public.is_staff()) AND ((recipient_id IS NULL) OR (recipient_id = (select auth.uid()))))$expr$),
    ('shipping_permissions','shipping_permissions_read','SELECT',
      $expr$((user_id = auth.uid()) OR shipping_private.can_manage())$expr$,null::text,
      $expr$((user_id = (select auth.uid())) OR (select shipping_private.can_manage()))$expr$,null::text)
  ) expected(table_name,policy_name,command,old_using,old_check,new_using,new_check)
  loop
    select * into v_actual from pg_policies where schemaname='public' and tablename=v_expected.table_name and policyname=v_expected.policy_name;
    if not found then raise exception 'rls_initplan_review_required:missing_policy:%',v_expected.policy_name; end if;
    -- Strip only known scalar wrappers and whitespace. No boolean conditions,
    -- casts, row references or access helpers are broadened by normalization.
    v_using:=regexp_replace(regexp_replace(coalesce(v_actual.qual,''),'\s+','','g'),v_wrapper_pattern,'\1','gi');
    v_check:=regexp_replace(regexp_replace(coalesce(v_actual.with_check,''),'\s+','','g'),v_wrapper_pattern,'\1','gi');
    if v_actual.permissive<>'PERMISSIVE' or v_actual.cmd<>v_expected.command or v_actual.roles<>array['authenticated']::name[]
      or v_using<>regexp_replace(coalesce(v_expected.old_using,''),'\s+','','g')
      or v_check<>regexp_replace(coalesce(v_expected.old_check,''),'\s+','','g') then
      raise exception 'rls_initplan_review_required:definition_changed:%',v_expected.policy_name;
    end if;
    if v_expected.policy_name='profiles_self_read' then
      -- Reject a preexisting scalar rewrite too: it would preserve the UPDATE
      -- recursion bug despite our exception. This policy must match literally.
      if regexp_replace(v_actual.qual,'\s+','','g')<>regexp_replace(v_expected.old_using,'\s+','','g') then
        raise exception 'rls_initplan_review_required:profile_read_sublink';
      end if;
      continue;
    end if;
    if v_expected.new_check is null then
      execute format('alter policy %I on public.%I using (%s)',v_expected.policy_name,v_expected.table_name,v_expected.new_using);
    else
      execute format('alter policy %I on public.%I using (%s) with check (%s)',v_expected.policy_name,v_expected.table_name,v_expected.new_using,v_expected.new_check);
    end if;
  end loop;
end $$;
