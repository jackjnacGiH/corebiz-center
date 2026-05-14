-- =========================================================================
-- 0008_marketing_tables.sql
-- Campaigns, coupons, abandoned carts.
-- =========================================================================

create table public.campaigns (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  type text not null default 'promotion'
    check (type in ('promotion','flash_sale','popup','abandoned_cart','email','sms','banner')),
  status text not null default 'draft'
    check (status in ('draft','scheduled','running','paused','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{"impressions":0,"clicks":0,"conversions":0,"revenue":0}'::jsonb,
  description text,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_status_idx on public.campaigns(status);
create index campaigns_type_idx   on public.campaigns(type);

create table public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  description text,
  discount_type text not null check (discount_type in ('percent','fixed','free_shipping')),
  discount_value numeric(12,2) not null default 0,
  min_purchase   numeric(14,2) not null default 0,
  max_uses int,
  used_count int not null default 0,
  per_customer_limit int,
  valid_from  timestamptz,
  valid_until timestamptz,
  campaign_id uuid references public.campaigns on delete set null,
  status text not null default 'active' check (status in ('active','inactive','expired','used_up')),
  applies_to jsonb not null default '{"all":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coupons_status_idx on public.coupons(status);
create index coupons_valid_idx  on public.coupons(valid_from, valid_until);

create table public.abandoned_carts (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid references public.customers on delete set null,
  email text,
  cart_data jsonb not null,
  cart_value numeric(14,2) not null default 0,
  reminder_count int not null default 0,
  last_reminder_at timestamptz,
  recovered boolean not null default false,
  recovered_order_id uuid references public.orders on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index abandoned_carts_recovered_idx on public.abandoned_carts(recovered, created_at desc);
create index abandoned_carts_email_idx     on public.abandoned_carts(email);

create trigger set_updated_at_campaigns       before update on public.campaigns       for each row execute function public.set_updated_at();
create trigger set_updated_at_coupons         before update on public.coupons         for each row execute function public.set_updated_at();
create trigger set_updated_at_abandoned_carts before update on public.abandoned_carts for each row execute function public.set_updated_at();

alter table public.campaigns       enable row level security;
alter table public.coupons         enable row level security;
alter table public.abandoned_carts enable row level security;

create policy campaigns_staff_all       on public.campaigns       for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy coupons_staff_all         on public.coupons         for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy abandoned_carts_staff_all on public.abandoned_carts for all to authenticated using (public.is_staff()) with check (public.is_staff());
