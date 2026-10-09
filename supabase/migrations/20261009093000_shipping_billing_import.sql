-- PromptSpeed statement imports. The raw workbook stays on the operator's
-- device; only normalized charge rows and an audit summary are persisted.
create table public.shipping_billing_imports (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('uat', 'production')),
  merchant_code text not null,
  file_name text not null check (length(file_name) between 1 and 255),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_name text not null check (length(sheet_name) between 1 and 150),
  total_rows integer not null default 0 check (total_rows between 0 and 5000),
  matched_rows integer not null default 0 check (matched_rows between 0 and total_rows),
  unmatched_rows integer not null default 0 check (unmatched_rows between 0 and total_rows),
  total_amount numeric(14, 2) not null default 0 check (total_amount >= 0),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (environment, merchant_code, file_sha256)
);

create table public.shipping_billing_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.shipping_billing_imports(id) on delete cascade,
  tracking_code text not null check (tracking_code ~ '^[A-Z0-9-]{5,80}$'),
  shipping_amount numeric(12, 2) not null check (shipping_amount >= 0),
  remote_area_fee numeric(12, 2) not null check (remote_area_fee >= 0),
  cod_fee numeric(12, 2) not null check (cod_fee >= 0),
  fee_vat numeric(12, 2) not null check (fee_vat >= 0),
  billed_amount numeric(12, 2) not null check (billed_amount >= 0),
  shipment_id uuid references public.shipments(id),
  created_at timestamptz not null default now(),
  unique (import_id, tracking_code)
);

create index shipping_billing_rows_tracking_idx
  on public.shipping_billing_rows (tracking_code);
create index shipping_billing_rows_shipment_idx
  on public.shipping_billing_rows (shipment_id)
  where shipment_id is not null;

alter table public.shipments
  add column provider_billed_amount numeric(12, 2)
    check (provider_billed_amount is null or provider_billed_amount >= 0),
  add column provider_billed_at timestamptz,
  add column provider_billing_import_id uuid
    references public.shipping_billing_imports(id) on delete set null;

comment on column public.shipments.provider_billed_amount is
  'Latest PromptSpeed statement amount matched by tracking number. This is separate from the live provider charge and customer sales-order shipping fee.';
comment on column public.shipments.provider_billed_at is
  'CoreBiz time when a PromptSpeed statement most recently matched this shipment.';

alter table public.shipping_billing_imports enable row level security;
alter table public.shipping_billing_rows enable row level security;
revoke all on public.shipping_billing_imports, public.shipping_billing_rows
  from public, anon, authenticated;
grant all on public.shipping_billing_imports, public.shipping_billing_rows
  to service_role;
grant usage, select on sequence public.shipping_billing_rows_id_seq
  to service_role;

create or replace function public.import_shipping_billing(
  p_file_name text,
  p_file_sha256 text,
  p_sheet_name text,
  p_rows jsonb,
  p_uploaded_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_environment text;
  v_merchant_code text;
  v_import public.shipping_billing_imports%rowtype;
  v_row jsonb;
  v_tracking text;
  v_shipment_id uuid;
  v_shipping numeric(12, 2);
  v_remote numeric(12, 2);
  v_cod numeric(12, 2);
  v_vat numeric(12, 2);
  v_billed numeric(12, 2);
  v_matched integer := 0;
  v_total numeric(14, 2) := 0;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_uploaded_by and is_active and role in ('owner', 'admin')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255
    or p_sheet_name is null or length(btrim(p_sheet_name)) not between 1 and 150
    or coalesce(p_file_sha256, '') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 5000
  then
    raise exception 'invalid_billing_import' using errcode = '22023';
  end if;

  select environment, merchant_code
    into v_environment, v_merchant_code
  from public.shipping_settings
  where id = true;
  if v_environment is null or v_merchant_code is null or v_merchant_code = '' then
    raise exception 'shipping_not_installed' using errcode = '22023';
  end if;

  select * into v_import
  from public.shipping_billing_imports
  where environment = v_environment
    and merchant_code = v_merchant_code
    and file_sha256 = p_file_sha256;
  if found then
    return jsonb_build_object(
      'import_id', v_import.id,
      'duplicate_file', true,
      'total_rows', v_import.total_rows,
      'matched_rows', v_import.matched_rows,
      'unmatched_rows', v_import.unmatched_rows,
      'total_amount', v_import.total_amount
    );
  end if;

  insert into public.shipping_billing_imports (
    environment, merchant_code, file_name, file_sha256, sheet_name, uploaded_by
  ) values (
    v_environment, v_merchant_code, btrim(p_file_name), p_file_sha256,
    btrim(p_sheet_name), p_uploaded_by
  ) returning * into v_import;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_tracking := upper(btrim(v_row ->> 'tracking_code'));
    if v_tracking is null or v_tracking !~ '^[A-Z0-9-]{5,80}$'
      or coalesce(v_row ->> 'shipping_amount', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
      or coalesce(v_row ->> 'remote_area_fee', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
      or coalesce(v_row ->> 'cod_fee', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
      or coalesce(v_row ->> 'fee_vat', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
    then
      raise exception 'invalid_billing_row' using errcode = '22023';
    end if;

    v_shipping := round((v_row ->> 'shipping_amount')::numeric, 2);
    v_remote := round((v_row ->> 'remote_area_fee')::numeric, 2);
    v_cod := round((v_row ->> 'cod_fee')::numeric, 2);
    v_vat := round((v_row ->> 'fee_vat')::numeric, 2);
    if greatest(v_shipping, v_remote, v_cod, v_vat) > 10000000 then
      raise exception 'invalid_billing_row' using errcode = '22023';
    end if;
    v_billed := round(v_shipping + v_remote + v_cod + v_vat, 2);
    v_total := v_total + v_billed;

    select id into v_shipment_id
    from public.shipments
    where environment = v_environment
      and merchant_code = v_merchant_code
      and upper(btrim(tracking_number)) = v_tracking
    limit 1;

    insert into public.shipping_billing_rows (
      import_id, tracking_code, shipping_amount, remote_area_fee,
      cod_fee, fee_vat, billed_amount, shipment_id
    ) values (
      v_import.id, v_tracking, v_shipping, v_remote,
      v_cod, v_vat, v_billed, v_shipment_id
    );

    if v_shipment_id is not null then
      update public.shipments
      set provider_billed_amount = v_billed,
          provider_billed_at = now(),
          provider_billing_import_id = v_import.id,
          version = version + 1,
          updated_by = p_uploaded_by,
          updated_at = now()
      where id = v_shipment_id;
      v_matched := v_matched + 1;
    end if;
  end loop;

  update public.shipping_billing_imports
  set total_rows = jsonb_array_length(p_rows),
      matched_rows = v_matched,
      unmatched_rows = jsonb_array_length(p_rows) - v_matched,
      total_amount = round(v_total, 2)
  where id = v_import.id
  returning * into v_import;

  return jsonb_build_object(
    'import_id', v_import.id,
    'duplicate_file', false,
    'total_rows', v_import.total_rows,
    'matched_rows', v_import.matched_rows,
    'unmatched_rows', v_import.unmatched_rows,
    'total_amount', v_import.total_amount
  );
end;
$$;

revoke all on function public.import_shipping_billing(text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.import_shipping_billing(text, text, text, jsonb, uuid)
  to service_role;
