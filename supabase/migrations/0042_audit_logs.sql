-- Admin RBAC Phase 1 — audit log of user-management / admin actions.
-- Writes happen only via the `admin-users` edge function (service role, which
-- bypasses RLS). Staff may read for a future audit-log viewer.
create extension if not exists pgcrypto;

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_staff_read on public.audit_logs;
create policy audit_logs_staff_read on public.audit_logs
  for select to authenticated using (public.is_staff());
