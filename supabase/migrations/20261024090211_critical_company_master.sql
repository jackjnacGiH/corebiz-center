-- Review patch only: no master values are seeded or approved by this migration.
-- The singleton already has established read/write policies; do not alter them.
alter table public.org_settings
  add column if not exists critical_company_master jsonb;

comment on column public.org_settings.critical_company_master is
  'Authenticated owner approval of revision-bound source selectors, without duplicate seller values. NULL or changed sources fail closed. Never approve from OCR or a generated response.';

-- Existing settings writers cannot impersonate an owner merely by inserting
-- that owner's UUID into JSON. Approval changes need the actual authenticated
-- owner/admin; service-role background jobs cannot silently approve data.
create or replace function public.guard_critical_company_master_approval()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_record jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.critical_company_master is not distinct from old.critical_company_master then return new; end if;
  elsif new.critical_company_master is null then
    return new;
  end if;
  if v_actor is null or not exists (
    select 1 from public.profiles where id = v_actor and is_active and role in ('owner','admin')
  ) then raise exception 'critical_master_owner_approval_required'; end if;
  if new.critical_company_master is not null then
    if new.critical_company_master->>'schema_version' is distinct from '2' then
      raise exception 'critical_master_source_binding_required';
    end if;
    if jsonb_typeof(new.critical_company_master->'records') is distinct from 'array' then
      raise exception 'critical_master_invalid_records';
    end if;
    if jsonb_array_length(new.critical_company_master->'records') <> 1 then
      raise exception 'critical_master_invalid_records';
    end if;
    for v_record in select value from jsonb_array_elements(new.critical_company_master->'records') loop
      if v_record ?| array['legal_name','registered_address','bank_accounts'] then
        raise exception 'critical_master_source_binding_required';
      end if;
      if v_record->>'active' = 'true' and v_record->>'status' = 'approved'
        and v_record->>'approved_by' is distinct from v_actor::text then
        raise exception 'critical_master_approver_mismatch';
      end if;
      if v_record->>'active' = 'true' and v_record->>'status' = 'approved' then
        new.critical_company_master := jsonb_set(new.critical_company_master,'{records,0}',
          v_record || jsonb_build_object('approved_at',now(),'valid_until',now()+interval '90 days'));
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_critical_company_master_approval on public.org_settings;
create trigger guard_critical_company_master_approval
before insert or update of critical_company_master on public.org_settings
for each row execute function public.guard_critical_company_master_approval();

-- Binding uses the existing owner-only settings UPDATE policy. No new RPC,
-- grants, policies or credentials are introduced.
