-- =========================================================================
-- 0010_affiliate_tables.sql
-- Affiliate / Dropship: agents, agent_links, commissions, agent_payouts
-- =========================================================================

create table public.agents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete set null,
  code text unique not null,
  name text not null,
  email text,
  phone text,
  commission_rate numeric(5,2) not null default 5.0 check (commission_rate between 0 and 100),
  tier text not null default 'starter' check (tier in ('starter','silver','gold','platinum')),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  total_clicks       int not null default 0,
  total_conversions  int not null default 0,
  total_sales        numeric(14,2) not null default 0,
  total_commission   numeric(14,2) not null default 0,
  pending_commission numeric(14,2) not null default 0,
  bank_account jsonb,
  joined_at   timestamptz not null default now(),
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_status_idx on public.agents(status);
create index agents_tier_idx   on public.agents(tier);
create index agents_user_idx   on public.agents(user_id);

create table public.agent_links (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents on delete cascade,
  short_code text unique not null,
  label text,
  destination_url text not null,
  campaign_id uuid references public.campaigns on delete set null,
  clicks      int not null default 0,
  conversions int not null default 0,
  revenue     numeric(14,2) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index agent_links_agent_idx on public.agent_links(agent_id);

create table public.commissions (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents,
  order_id uuid not null references public.orders,
  agent_link_id uuid references public.agent_links on delete set null,
  amount numeric(14,2) not null,
  rate   numeric(5,2) not null,
  order_total numeric(14,2) not null,
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  approved_at timestamptz,
  paid_at     timestamptz,
  payout_id   uuid,
  note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index commissions_agent_idx on public.commissions(agent_id, status);
create index commissions_order_idx on public.commissions(order_id);

create table public.agent_payouts (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references public.agents,
  total_amount numeric(14,2) not null,
  commission_count int not null,
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','cancelled')),
  method text,
  reference text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create trigger set_updated_at_agents       before update on public.agents       for each row execute function public.set_updated_at();
create trigger set_updated_at_commissions  before update on public.commissions  for each row execute function public.set_updated_at();

alter table public.agents        enable row level security;
alter table public.agent_links   enable row level security;
alter table public.commissions   enable row level security;
alter table public.agent_payouts enable row level security;

create policy agents_staff_all        on public.agents        for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy agent_links_staff_all   on public.agent_links   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy commissions_staff_all   on public.commissions   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy agent_payouts_staff_all on public.agent_payouts for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Agents read their own
create policy agents_self_read      on public.agents      for select to authenticated using (user_id = auth.uid());
create policy agent_links_self_read on public.agent_links for select to authenticated using (
  agent_id in (select id from public.agents where user_id = auth.uid())
);
create policy commissions_self_read on public.commissions for select to authenticated using (
  agent_id in (select id from public.agents where user_id = auth.uid())
);

create or replace function public.tg_commission_inserted()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.agents
  set total_conversions = total_conversions + 1,
      total_sales       = total_sales + NEW.order_total,
      total_commission  = total_commission + case when NEW.status = 'paid' then NEW.amount else 0 end,
      pending_commission = pending_commission + case when NEW.status in ('pending','approved') then NEW.amount else 0 end
  where id = NEW.agent_id;
  return NEW;
end;
$$;

drop trigger if exists commission_inserted_trigger on public.commissions;
create trigger commission_inserted_trigger
  after insert on public.commissions
  for each row execute function public.tg_commission_inserted();
