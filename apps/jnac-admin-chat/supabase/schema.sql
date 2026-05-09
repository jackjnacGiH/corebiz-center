create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.admin_users (email)
values
  ('supanrattanakool@gmail.com'),
  ('sinsupan49@gmail.com'),
  ('jnac.co.th@gmail.com')
on conflict (email) do nothing;

create table if not exists public.products_current (
  product_code text primary key,
  name text not null default '',
  category text not null default '',
  description text not null default '',
  unit text not null default '',
  price numeric,
  inventory_price numeric,
  price_source text not null default '',
  price_rule_id text,
  price_rule_name text not null default '',
  price_rule_grits text[] not null default '{}',
  stock numeric,
  min_stock numeric,
  availability text not null default '',
  shelf text not null default '',
  row text not null default '',
  flowaccount_qty numeric,
  embedding_text text not null default '',
  answer_text text not null default '',
  embedding_hash text,
  live_hash text,
  row_hash text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists products_current_name_idx on public.products_current using gin (to_tsvector('simple', name));
create index if not exists products_current_category_idx on public.products_current (category);
create index if not exists products_current_price_rule_idx on public.products_current (price_rule_id);

create table if not exists public.product_price_rules (
  id text primary key,
  source_row text,
  source_product_code text,
  name text not null default '',
  base_name text not null default '',
  base_key text not null default '',
  grits text[] not null default '{}',
  unit text not null default '',
  price numeric not null,
  detail text not null default '',
  note text not null default '',
  embedding_text text not null default '',
  answer_text text not null default '',
  rule_hash text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists product_price_rules_base_key_idx on public.product_price_rules (base_key);
create index if not exists product_price_rules_name_idx on public.product_price_rules using gin (to_tsvector('simple', name));

create table if not exists public.website_knowledge (
  id text primary key,
  title text not null default '',
  category text not null default '',
  content text not null default '',
  source_url text not null default '',
  embedding_hash text,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_admin_updated_idx on public.chat_sessions (admin_email, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx on public.chat_messages (session_id, created_at);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.products_current enable row level security;
alter table public.product_price_rules enable row level security;
alter table public.website_knowledge enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.sync_runs enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists admin_users_read_admin on public.admin_users;
create policy admin_users_read_admin
on public.admin_users
for select
to authenticated
using (public.is_admin());

drop policy if exists products_read_admin on public.products_current;
create policy products_read_admin
on public.products_current
for select
to authenticated
using (public.is_admin());

drop policy if exists price_rules_read_admin on public.product_price_rules;
create policy price_rules_read_admin
on public.product_price_rules
for select
to authenticated
using (public.is_admin());

drop policy if exists website_knowledge_read_admin on public.website_knowledge;
create policy website_knowledge_read_admin
on public.website_knowledge
for select
to authenticated
using (public.is_admin());

drop policy if exists sync_runs_read_admin on public.sync_runs;
create policy sync_runs_read_admin
on public.sync_runs
for select
to authenticated
using (public.is_admin());

drop policy if exists chat_sessions_read_own_admin on public.chat_sessions;
create policy chat_sessions_read_own_admin
on public.chat_sessions
for select
to authenticated
using (public.is_admin() and admin_email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists chat_sessions_insert_own_admin on public.chat_sessions;
create policy chat_sessions_insert_own_admin
on public.chat_sessions
for insert
to authenticated
with check (public.is_admin() and admin_email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists chat_sessions_update_own_admin on public.chat_sessions;
create policy chat_sessions_update_own_admin
on public.chat_sessions
for update
to authenticated
using (public.is_admin() and admin_email = lower(coalesce(auth.jwt() ->> 'email', '')))
with check (public.is_admin() and admin_email = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists chat_messages_read_own_admin on public.chat_messages;
create policy chat_messages_read_own_admin
on public.chat_messages
for select
to authenticated
using (
  public.is_admin()
  and exists (
    select 1
    from public.chat_sessions session
    where session.id = chat_messages.session_id
      and session.admin_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists chat_messages_insert_own_admin on public.chat_messages;
create policy chat_messages_insert_own_admin
on public.chat_messages
for insert
to authenticated
with check (
  public.is_admin()
  and exists (
    select 1
    from public.chat_sessions session
    where session.id = chat_messages.session_id
      and session.admin_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

create or replace function public.sync_jnac_data(
  products jsonb,
  price_rules jsonb,
  run_summary jsonb,
  sync_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected_hash constant text := '444b722dc7b18996ffe12aa7cc335f5c3bcfd54f3ddcd723588d5b910857f53c';
  changed_rows bigint := 0;
  changed_embedding_rows bigint := 0;
  changed_live_rows bigint := 0;
  final_summary jsonb;
begin
  if encode(extensions.digest(coalesce(sync_secret, '')::text, 'sha256'::text), 'hex') <> expected_hash then
    raise exception 'invalid sync secret' using errcode = '28000';
  end if;

  select count(*) into changed_rows
  from jsonb_array_elements(coalesce(products, '[]'::jsonb)) elem
  left join public.products_current existing
    on existing.product_code = elem ->> 'product_code'
  where existing.row_hash is distinct from (elem ->> 'row_hash');

  select count(*) into changed_embedding_rows
  from jsonb_array_elements(coalesce(products, '[]'::jsonb)) elem
  left join public.products_current existing
    on existing.product_code = elem ->> 'product_code'
  where existing.embedding_hash is distinct from (elem ->> 'embedding_hash');

  select count(*) into changed_live_rows
  from jsonb_array_elements(coalesce(products, '[]'::jsonb)) elem
  left join public.products_current existing
    on existing.product_code = elem ->> 'product_code'
  where existing.live_hash is distinct from (elem ->> 'live_hash');

  insert into public.product_price_rules (
    id,
    source_row,
    source_product_code,
    name,
    base_name,
    base_key,
    grits,
    unit,
    price,
    detail,
    note,
    embedding_text,
    answer_text,
    rule_hash,
    raw,
    updated_at
  )
  select
    elem ->> 'id',
    elem ->> 'source_row',
    elem ->> 'source_product_code',
    coalesce(elem ->> 'name', ''),
    coalesce(elem ->> 'base_name', ''),
    coalesce(elem ->> 'base_key', ''),
    array(select jsonb_array_elements_text(coalesce(elem -> 'grits', '[]'::jsonb))),
    coalesce(elem ->> 'unit', ''),
    coalesce(nullif(elem ->> 'price', '')::numeric, 0),
    coalesce(elem ->> 'detail', ''),
    coalesce(elem ->> 'note', ''),
    coalesce(elem ->> 'embedding_text', ''),
    coalesce(elem ->> 'answer_text', ''),
    elem ->> 'rule_hash',
    coalesce(elem -> 'raw', elem),
    now()
  from jsonb_array_elements(coalesce(price_rules, '[]'::jsonb)) elem
  where elem ->> 'id' is not null
  on conflict (id) do update set
    source_row = excluded.source_row,
    source_product_code = excluded.source_product_code,
    name = excluded.name,
    base_name = excluded.base_name,
    base_key = excluded.base_key,
    grits = excluded.grits,
    unit = excluded.unit,
    price = excluded.price,
    detail = excluded.detail,
    note = excluded.note,
    embedding_text = excluded.embedding_text,
    answer_text = excluded.answer_text,
    rule_hash = excluded.rule_hash,
    raw = excluded.raw,
    updated_at = excluded.updated_at;

  insert into public.products_current (
    product_code,
    name,
    category,
    description,
    unit,
    price,
    inventory_price,
    price_source,
    price_rule_id,
    price_rule_name,
    price_rule_grits,
    stock,
    min_stock,
    availability,
    shelf,
    row,
    flowaccount_qty,
    embedding_text,
    answer_text,
    embedding_hash,
    live_hash,
    row_hash,
    raw,
    updated_at
  )
  select
    elem ->> 'product_code',
    coalesce(elem ->> 'name', ''),
    coalesce(elem ->> 'category', ''),
    coalesce(elem ->> 'description', ''),
    coalesce(elem ->> 'unit', ''),
    nullif(elem ->> 'price', '')::numeric,
    nullif(elem ->> 'inventory_price', '')::numeric,
    coalesce(elem ->> 'price_source', ''),
    elem ->> 'price_rule_id',
    coalesce(elem ->> 'price_rule_name', ''),
    array(select jsonb_array_elements_text(coalesce(elem -> 'price_rule_grits', '[]'::jsonb))),
    nullif(elem ->> 'stock', '')::numeric,
    nullif(elem ->> 'min_stock', '')::numeric,
    coalesce(elem ->> 'availability', ''),
    coalesce(elem ->> 'shelf', ''),
    coalesce(elem ->> 'row', ''),
    nullif(elem ->> 'flowaccount_qty', '')::numeric,
    coalesce(elem ->> 'embedding_text', ''),
    coalesce(elem ->> 'answer_text', ''),
    elem ->> 'embedding_hash',
    elem ->> 'live_hash',
    elem ->> 'row_hash',
    coalesce(elem -> 'raw', elem),
    now()
  from jsonb_array_elements(coalesce(products, '[]'::jsonb)) elem
  where elem ->> 'product_code' is not null
  on conflict (product_code) do update set
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    unit = excluded.unit,
    price = excluded.price,
    inventory_price = excluded.inventory_price,
    price_source = excluded.price_source,
    price_rule_id = excluded.price_rule_id,
    price_rule_name = excluded.price_rule_name,
    price_rule_grits = excluded.price_rule_grits,
    stock = excluded.stock,
    min_stock = excluded.min_stock,
    availability = excluded.availability,
    shelf = excluded.shelf,
    row = excluded.row,
    flowaccount_qty = excluded.flowaccount_qty,
    embedding_text = excluded.embedding_text,
    answer_text = excluded.answer_text,
    embedding_hash = excluded.embedding_hash,
    live_hash = excluded.live_hash,
    row_hash = excluded.row_hash,
    raw = excluded.raw,
    updated_at = excluded.updated_at;

  final_summary := coalesce(run_summary, '{}'::jsonb) || jsonb_build_object(
    'changed_rows', changed_rows,
    'changed_embedding_rows', changed_embedding_rows,
    'changed_live_rows', changed_live_rows
  );

  return final_summary;
end;
$$;

revoke all on function public.sync_jnac_data(jsonb, jsonb, jsonb, text) from public, authenticated;
grant execute on function public.sync_jnac_data(jsonb, jsonb, jsonb, text) to anon;

create or replace function public.record_jnac_sync(
  run_summary jsonb,
  sync_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  expected_hash constant text := '444b722dc7b18996ffe12aa7cc335f5c3bcfd54f3ddcd723588d5b910857f53c';
begin
  if encode(extensions.digest(coalesce(sync_secret, '')::text, 'sha256'::text), 'hex') <> expected_hash then
    raise exception 'invalid sync secret' using errcode = '28000';
  end if;

  insert into public.sync_runs (status, summary)
  values ('success', coalesce(run_summary, '{}'::jsonb));

  return coalesce(run_summary, '{}'::jsonb);
end;
$$;

revoke all on function public.record_jnac_sync(jsonb, text) from public, authenticated;
grant execute on function public.record_jnac_sync(jsonb, text) to anon;
