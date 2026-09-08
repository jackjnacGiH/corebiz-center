-- Shipping foundation: backend-only writes, explicit staff grants, immutable audit.
-- No triggers write to orders, inventory, payments or existing business tables.
create schema if not exists shipping_private;
revoke all on schema shipping_private from public, anon;
grant usage on schema shipping_private to authenticated, service_role;

create table public.shipping_permissions (
  user_id uuid primary key references public.profiles(id),
  granted_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create or replace function shipping_private.can_manage() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('owner','admin'));
$$;
create or replace function shipping_private.can_use() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and
    (p.role in ('owner','admin') or (p.role='staff' and exists(select 1 from public.shipping_permissions s where s.user_id=p.id))));
$$;
revoke all on function shipping_private.can_manage(), shipping_private.can_use() from public, anon;
grant execute on function shipping_private.can_manage(), shipping_private.can_use() to authenticated, service_role;

create table public.shipping_settings (
  id boolean primary key default true check(id),
  environment text not null default 'uat' check(environment in ('uat','production')),
  billing_mode text not null default 'unconfirmed' check(billing_mode in ('unconfirmed','prepaid','postpaid')),
  merchant_code text not null default '',
  origin jsonb not null default '{}'::jsonb check(jsonb_typeof(origin)='object'),
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.shipping_settings(id) values(true);
create table public.shipping_cod_accounts (
  id uuid primary key default gen_random_uuid(), label text not null check(length(label) between 1 and 150),
  provider_account_id text not null check(length(provider_account_id) between 1 and 100),
  environment text not null check(environment in ('uat','production')),
  merchant_code text not null check(length(merchant_code)>0),
  active boolean not null default false, updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
  unique(environment, merchant_code, provider_account_id)
);
create table public.shipments (
  id uuid primary key, reference_no text not null unique,
  order_id uuid references public.orders(id), order_code text,
  draft jsonb not null check(jsonb_typeof(draft)='object'),
  status text not null default 'draft' check(status in ('draft','submitting','outcome_unknown','waiting','on_delivery','delivered','on_return','returned','claimed','closed','canceled','archived')),
  environment text not null check(environment in ('uat','production')), merchant_code text not null default '',
  tracking_number text, provider_updated_at timestamptz, version integer not null default 1 check(version>0),
  created_by uuid not null references public.profiles(id), updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((order_id is null)=(order_code is null))
);
create index shipments_page_idx on public.shipments(created_at desc,id desc);
create index shipments_order_idx on public.shipments(order_id);
create unique index shipments_tracking_idx on public.shipments(environment,merchant_code,tracking_number) where tracking_number is not null;
create table public.shipping_audit (
  id bigint generated always as identity primary key, entity text not null, entity_id text not null,
  operation text not null, actor_id uuid, old_status text, new_status text,
  created_at timestamptz not null default now()
);
create table public.shipping_attempts (
  id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments(id),
  operation text not null, outcome text not null check(outcome in ('pending','success','rejected','unknown')),
  http_status integer, provider_request_id text, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table public.shipping_events (
  id uuid primary key default gen_random_uuid(), shipment_id uuid references public.shipments(id),
  event_key text not null unique, kind text not null, provider_time timestamptz,
  received_at timestamptz not null default now(), payload jsonb not null, processed_at timestamptz
);
create or replace function shipping_private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb; old_data jsonb;
begin
  if TG_OP='DELETE' then row_data=to_jsonb(OLD); else row_data=to_jsonb(NEW); end if;
  if TG_OP='UPDATE' then old_data=to_jsonb(OLD); end if;
  insert into public.shipping_audit(entity,entity_id,operation,actor_id,old_status,new_status)
  values(TG_TABLE_NAME,coalesce(row_data->>'id',row_data->>'user_id'),TG_OP,
    coalesce(auth.uid(),nullif(row_data->>'updated_by','')::uuid,nullif(row_data->>'granted_by','')::uuid),old_data->>'status',row_data->>'status');
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function shipping_private.audit_change() from public, anon, authenticated;
create trigger shipments_audit after insert or update on public.shipments for each row execute function shipping_private.audit_change();
create trigger shipping_settings_audit after update on public.shipping_settings for each row execute function shipping_private.audit_change();
create trigger shipping_cod_audit after insert or update on public.shipping_cod_accounts for each row execute function shipping_private.audit_change();
create trigger shipping_permissions_audit after insert or update or delete on public.shipping_permissions for each row execute function shipping_private.audit_change();

alter table public.shipping_permissions enable row level security;
alter table public.shipping_settings enable row level security;
alter table public.shipping_cod_accounts enable row level security;
alter table public.shipments enable row level security;
alter table public.shipping_audit enable row level security;
alter table public.shipping_attempts enable row level security;
alter table public.shipping_events enable row level security;
revoke all on public.shipping_permissions,public.shipping_settings,public.shipping_cod_accounts,public.shipments,public.shipping_audit,public.shipping_attempts,public.shipping_events from public,anon,authenticated;
grant select on public.shipments to authenticated;
grant select on public.shipping_permissions to authenticated;
grant select on public.shipping_settings,public.shipping_cod_accounts,public.shipping_audit to authenticated;
create policy shipments_read on public.shipments for select to authenticated using(shipping_private.can_use());
create policy shipping_permissions_read on public.shipping_permissions for select to authenticated using(user_id=auth.uid() or shipping_private.can_manage());
create policy shipping_settings_read on public.shipping_settings for select to authenticated using(shipping_private.can_manage());
create policy shipping_cod_read on public.shipping_cod_accounts for select to authenticated using(shipping_private.can_manage());
create policy shipping_audit_read on public.shipping_audit for select to authenticated using(shipping_private.can_manage());
grant all on public.shipping_permissions,public.shipping_settings,public.shipping_cod_accounts,public.shipments,public.shipping_audit,public.shipping_attempts,public.shipping_events to service_role;
grant usage,select on sequence public.shipping_audit_id_seq to service_role;
