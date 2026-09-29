alter table public.shipments
  add column provider_charge numeric(12, 2)
    check (provider_charge is null or provider_charge >= 0),
  add column provider_charge_checked_at timestamptz;

comment on column public.shipments.provider_charge is
  'Latest confirmed carrier charge from PromptSpeed create/list responses; never overwrites the sales-order shipping fee.';

comment on column public.shipments.provider_charge_checked_at is
  'CoreBiz time when provider_charge was last confirmed from PromptSpeed.';
