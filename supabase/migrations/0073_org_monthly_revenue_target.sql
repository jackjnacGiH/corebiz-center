-- Capture the production org_settings column in version control.
-- Production already has this column; IF NOT EXISTS keeps the migration safe there.
alter table public.org_settings
  add column if not exists monthly_revenue_target numeric default 2000000;

comment on column public.org_settings.monthly_revenue_target is
  'Monthly revenue target used by the CoreBiz dashboard KPI.';
