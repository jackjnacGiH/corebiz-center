-- Admin RBAC Phase 2 — read-only roles (agent/viewer) + delete restricted to
-- owner/admin on main entity tables. All changes are ADDITIVE (extra policies)
-- so existing owner/admin/staff read+write behaviour is unchanged.

-- 1) allow the new 'viewer' role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner','admin','staff','agent','customer','viewer'));

-- 2) capability helpers
create or replace function public.can_read() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and p.role in ('owner','admin','staff','agent','viewer')); $$;
create or replace function public.can_write() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and p.role in ('owner','admin','staff')); $$;
create or replace function public.can_delete() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and p.role in ('owner','admin')); $$;
revoke all on function public.can_read() from public, anon;
revoke all on function public.can_write() from public, anon;
revoke all on function public.can_delete() from public, anon;
grant execute on function public.can_read() to authenticated;
grant execute on function public.can_write() to authenticated;
grant execute on function public.can_delete() to authenticated;

-- 3) broaden READ to the read-only roles on every staff-readable table
--    (skip profiles + audit_logs — those stay owner/admin-scoped).
do $$
declare t text;
begin
  for t in
    select distinct tablename from pg_policies
    where schemaname = 'public'
      and coalesce(qual,'') like '%is_staff%'
      and tablename not in ('profiles','audit_logs')
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read_all', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read())',
      t || '_read_all', t);
  end loop;
end $$;

-- 4) restrict DELETE to owner/admin on main entity tables (RESTRICTIVE = ANDs
--    with the existing permissive is_staff policy, so staff lose delete here;
--    line-item/chat/inventory tables are intentionally left staff-deletable so
--    edit flows keep working).
do $$
declare t text;
declare entity_tables text[] := array[
  'products','categories','warehouses','customers','orders','quotes',
  'agents','campaigns','coupons','line_channels','tier_benefits'];
begin
  foreach t in array entity_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_no_staff_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (public.can_delete())',
      t || '_no_staff_delete', t);
  end loop;
end $$;
