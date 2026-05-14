-- =========================================================================
-- CoreBiz Center — Initial Schema (Phase 0)
-- =========================================================================
-- This migration creates the core tables for products, customers, orders,
-- inventory, and the RAG knowledge base.
--
-- IMPORTANT: Phaya embedding dimension must be confirmed before running.
--   Run: node api/test_embed.js
--   If dimension is NOT 1024, edit the `vector(1024)` definition below.
-- =========================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- -------------------------------------------------------------------------
-- profiles — extends auth.users
-- -------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text unique not null,
  full_name    text,
  avatar_url   text,
  phone        text,
  role         text not null default 'staff'
                 check (role in ('owner','admin','staff','agent','customer')),
  language     text not null default 'th' check (language in ('th','en')),
  provider     text default 'email' check (provider in ('email','google','line')),
  line_user_id text unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles(role);
create index profiles_line_user_id_idx on public.profiles(line_user_id) where line_user_id is not null;

-- -------------------------------------------------------------------------
-- helper: is_staff() — for RLS policies
-- -------------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('owner','admin','staff')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'owner'
  );
$$;

revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, provider)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_app_meta_data->>'provider', 'email')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------------
-- categories
-- -------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default uuid_generate_v4(),
  parent_id   uuid references public.categories on delete set null,
  slug        text unique not null,
  name_th     text not null,
  name_en     text,
  description text,
  icon        text,
  sort_order  int default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_parent_idx on public.categories(parent_id);

-- -------------------------------------------------------------------------
-- warehouses
-- -------------------------------------------------------------------------
create table public.warehouses (
  id         uuid primary key default uuid_generate_v4(),
  code       text unique not null,
  name       text not null,
  address    text,
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Ensure only ONE default warehouse
create unique index warehouses_one_default_idx
  on public.warehouses (is_default) where is_default = true;

-- -------------------------------------------------------------------------
-- products
-- -------------------------------------------------------------------------
create table public.products (
  id              uuid primary key default uuid_generate_v4(),
  sku             text unique not null,
  name_th         text not null,
  name_en         text,
  description_th  text,
  description_en  text,
  category_id     uuid references public.categories on delete set null,
  brand           text,
  unit            text not null default 'pcs',
  price           numeric(12,2) not null default 0,
  cost            numeric(12,2) default 0,
  weight_kg       numeric(10,3) default 0,
  images          jsonb not null default '[]'::jsonb,
  spec            jsonb not null default '{}'::jsonb,
  tags            text[] not null default '{}',
  barcode         text unique,
  status          text not null default 'active'
                    check (status in ('active','draft','archived')),
  is_featured     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_category_idx on public.products(category_id);
create index products_status_idx on public.products(status);
create index products_name_search_idx on public.products
  using gin (to_tsvector('simple', coalesce(name_th,'') || ' ' || coalesce(name_en,'')));

-- -------------------------------------------------------------------------
-- product_variants — for size/color/grit variants
-- -------------------------------------------------------------------------
create table public.product_variants (
  id          uuid primary key default uuid_generate_v4(),
  product_id  uuid not null references public.products on delete cascade,
  sku         text unique not null,
  name        text not null,
  attributes  jsonb not null default '{}'::jsonb,
  price_diff  numeric(12,2) not null default 0,
  barcode     text unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index product_variants_product_idx on public.product_variants(product_id);

-- -------------------------------------------------------------------------
-- inventory — quantity per (product, variant, warehouse)
-- -------------------------------------------------------------------------
create table public.inventory (
  id            uuid primary key default uuid_generate_v4(),
  product_id    uuid not null references public.products on delete cascade,
  variant_id    uuid references public.product_variants on delete cascade,
  warehouse_id  uuid not null references public.warehouses on delete restrict,
  quantity      int not null default 0 check (quantity >= 0),
  reserved      int not null default 0 check (reserved >= 0),
  reorder_level int not null default 10,
  shelf         text,
  row_no        text,
  updated_at    timestamptz not null default now(),
  unique (product_id, variant_id, warehouse_id)
);

create index inventory_product_idx on public.inventory(product_id);
create index inventory_warehouse_idx on public.inventory(warehouse_id);
create index inventory_low_stock_idx on public.inventory(quantity)
  where quantity <= reorder_level;

-- -------------------------------------------------------------------------
-- inventory_movements — audit trail of stock changes
-- -------------------------------------------------------------------------
create table public.inventory_movements (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references public.products,
  variant_id      uuid references public.product_variants,
  warehouse_id    uuid not null references public.warehouses,
  movement_type   text not null check (movement_type in ('in','out','adjust','transfer','reserve','release')),
  quantity        int not null,
  reference_type  text,
  reference_id    uuid,
  note            text,
  created_by      uuid references auth.users,
  created_at      timestamptz not null default now()
);

create index inventory_movements_product_idx on public.inventory_movements(product_id, created_at desc);
create index inventory_movements_reference_idx on public.inventory_movements(reference_type, reference_id);

-- -------------------------------------------------------------------------
-- customers
-- -------------------------------------------------------------------------
create table public.customers (
  id               uuid primary key default uuid_generate_v4(),
  code             text unique,
  name             text not null,
  customer_type    text not null default 'individual'
                     check (customer_type in ('individual','company')),
  tier             text not null default 'general'
                     check (tier in ('general','silver','gold','vip')),
  email            text,
  phone            text,
  tax_id           text,
  billing_address  jsonb,
  shipping_address jsonb,
  total_spent      numeric(14,2) not null default 0,
  total_orders     int not null default 0,
  loyalty_points   int not null default 0,
  tags             text[] not null default '{}',
  notes            text,
  user_id          uuid references auth.users on delete set null,
  source_channel   text default 'manual',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index customers_email_idx on public.customers(lower(email));
create index customers_phone_idx on public.customers(phone);
create index customers_tier_idx on public.customers(tier);
create index customers_user_id_idx on public.customers(user_id);
create index customers_name_search_idx on public.customers
  using gin (to_tsvector('simple', name));

-- -------------------------------------------------------------------------
-- orders
-- -------------------------------------------------------------------------
create table public.orders (
  id               uuid primary key default uuid_generate_v4(),
  code             text unique not null,
  customer_id      uuid references public.customers on delete restrict,
  status           text not null default 'pending'
                     check (status in ('pending','processing','shipped','delivered','cancelled','returned')),
  payment_status   text not null default 'unpaid'
                     check (payment_status in ('unpaid','partial','paid','refunded')),
  payment_method   text,
  channel          text not null default 'web',
  subtotal         numeric(14,2) not null default 0,
  discount         numeric(14,2) not null default 0,
  vat              numeric(14,2) not null default 0,
  shipping_fee     numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  shipping_address jsonb,
  tracking_no      text,
  carrier          text,
  notes            text,
  internal_notes   text,
  created_by       uuid references auth.users,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index orders_customer_idx on public.orders(customer_id);
create index orders_status_idx on public.orders(status);
create index orders_created_idx on public.orders(created_at desc);

create table public.order_items (
  id            uuid primary key default uuid_generate_v4(),
  order_id      uuid not null references public.orders on delete cascade,
  product_id    uuid not null references public.products,
  variant_id    uuid references public.product_variants,
  sku           text not null,
  product_name  text not null,
  quantity      int not null check (quantity > 0),
  unit_price    numeric(12,2) not null,
  discount      numeric(12,2) not null default 0,
  total         numeric(14,2) not null,
  created_at    timestamptz not null default now()
);

create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

-- -------------------------------------------------------------------------
-- quotes (ใบเสนอราคา)
-- -------------------------------------------------------------------------
create table public.quotes (
  id           uuid primary key default uuid_generate_v4(),
  code         text unique not null,
  customer_id  uuid references public.customers on delete set null,
  status       text not null default 'draft'
                 check (status in ('draft','sent','accepted','rejected','expired','converted')),
  subtotal     numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  vat          numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  valid_until  date,
  converted_to_order_id uuid references public.orders on delete set null,
  notes        text,
  created_by   uuid references auth.users,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index quotes_customer_idx on public.quotes(customer_id);
create index quotes_status_idx on public.quotes(status);

create table public.quote_items (
  id           uuid primary key default uuid_generate_v4(),
  quote_id     uuid not null references public.quotes on delete cascade,
  product_id   uuid not null references public.products,
  variant_id   uuid references public.product_variants,
  sku          text not null,
  product_name text not null,
  quantity     int not null check (quantity > 0),
  unit_price   numeric(12,2) not null,
  discount     numeric(12,2) not null default 0,
  total        numeric(14,2) not null
);

create index quote_items_quote_idx on public.quote_items(quote_id);

-- -------------------------------------------------------------------------
-- knowledge_chunks — RAG vector store (synced from Obsidian Vault)
-- -------------------------------------------------------------------------
-- NOTE: vector(1024) assumes Phaya embedding dimension = 1024.
--       Verify by running `node api/test_embed.js` and updating if needed.
create table public.knowledge_chunks (
  id            uuid primary key default uuid_generate_v4(),
  source_path   text not null,
  source_type   text not null default 'obsidian'
                  check (source_type in ('obsidian','manual','upload','crawl')),
  title         text,
  content       text not null,
  metadata      jsonb not null default '{}'::jsonb,
  embedding     vector(1024),
  language      text not null default 'th' check (language in ('th','en','mixed')),
  token_count   int,
  chunk_index   int not null default 0,
  content_hash  text not null,
  tags          text[] not null default '{}',
  visibility    text not null default 'public' check (visibility in ('public','internal')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source_path, chunk_index)
);

create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create index knowledge_chunks_source_idx on public.knowledge_chunks(source_path);
create index knowledge_chunks_tags_idx on public.knowledge_chunks using gin (tags);
create index knowledge_chunks_visibility_idx on public.knowledge_chunks(visibility);

-- Vector similarity search function
create or replace function public.match_knowledge(
  query_embedding   vector(1024),
  match_threshold   float default 0.65,
  match_count       int default 5,
  filter_language   text default null,
  filter_visibility text default 'public'
)
returns table (
  id          uuid,
  title       text,
  content     text,
  source_path text,
  metadata    jsonb,
  tags        text[],
  similarity  float
)
language sql
stable
as $$
  select
    kc.id,
    kc.title,
    kc.content,
    kc.source_path,
    kc.metadata,
    kc.tags,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
    and (filter_language is null or kc.language = filter_language)
    and (filter_visibility is null or kc.visibility = filter_visibility)
    and 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(vector, float, int, text, text) from public, anon;
grant execute on function public.match_knowledge(vector, float, int, text, text) to authenticated;

-- -------------------------------------------------------------------------
-- updated_at trigger helper
-- -------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at_profiles before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at_categories before update on public.categories
  for each row execute function public.set_updated_at();
create trigger set_updated_at_products before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at_inventory before update on public.inventory
  for each row execute function public.set_updated_at();
create trigger set_updated_at_customers before update on public.customers
  for each row execute function public.set_updated_at();
create trigger set_updated_at_orders before update on public.orders
  for each row execute function public.set_updated_at();
create trigger set_updated_at_quotes before update on public.quotes
  for each row execute function public.set_updated_at();
create trigger set_updated_at_knowledge_chunks before update on public.knowledge_chunks
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- Customer totals recalculation on order paid/delivered
-- -------------------------------------------------------------------------
create or replace function public.recalculate_customer_totals(p_customer_id uuid)
returns void
language plpgsql
as $$
declare
  v_total_spent numeric(14,2);
  v_total_orders int;
  v_new_tier text;
begin
  select
    coalesce(sum(total), 0),
    count(*)
  into v_total_spent, v_total_orders
  from public.orders
  where customer_id = p_customer_id
    and status not in ('cancelled','returned')
    and payment_status = 'paid';

  v_new_tier := case
    when v_total_spent >= 500000 then 'vip'
    when v_total_spent >= 200000 then 'gold'
    when v_total_spent >= 50000  then 'silver'
    else 'general'
  end;

  update public.customers
  set total_spent = v_total_spent,
      total_orders = v_total_orders,
      tier = v_new_tier
  where id = p_customer_id;
end;
$$;

-- =========================================================================
-- ROW LEVEL SECURITY
-- =========================================================================

alter table public.profiles            enable row level security;
alter table public.categories          enable row level security;
alter table public.warehouses          enable row level security;
alter table public.products            enable row level security;
alter table public.product_variants    enable row level security;
alter table public.inventory           enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.customers           enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.quotes              enable row level security;
alter table public.quote_items         enable row level security;
alter table public.knowledge_chunks    enable row level security;

-- profiles: users can read own; staff can read all; owner can update roles
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

create policy profiles_owner_all on public.profiles
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- Read-only public-ish tables (staff full access)
create policy categories_staff_all on public.categories
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy warehouses_staff_all on public.warehouses
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy products_staff_all on public.products
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy product_variants_staff_all on public.product_variants
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy inventory_staff_all on public.inventory
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy inventory_movements_staff_all on public.inventory_movements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy customers_staff_all on public.customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy orders_staff_all on public.orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy order_items_staff_all on public.order_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy quotes_staff_all on public.quotes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy quote_items_staff_all on public.quote_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy knowledge_chunks_staff_all on public.knowledge_chunks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Public read for active products (for marketing site / customer-facing widgets)
create policy products_public_read on public.products
  for select to anon
  using (status = 'active');

create policy categories_public_read on public.categories
  for select to anon
  using (is_active = true);

-- =========================================================================
-- SEED DATA
-- =========================================================================

insert into public.warehouses (code, name, address, is_default)
values ('MAIN', 'คลังหลัก กรุงเทพ', 'Bangkok HQ', true)
on conflict (code) do nothing;

insert into public.categories (slug, name_th, name_en, sort_order) values
  ('abrasives',       'งานขัด',           'Abrasives',       10),
  ('cutting',         'งานตัด',           'Cutting',         20),
  ('grinding',        'งานเจียร์',         'Grinding',        30),
  ('polishing',       'งานปัดเงา',         'Polishing',       40),
  ('pneumatic-tools', 'เครื่องมือลม',     'Pneumatic Tools', 50),
  ('safety',          'อุปกรณ์เซฟตี้',     'Safety',          60)
on conflict (slug) do nothing;
