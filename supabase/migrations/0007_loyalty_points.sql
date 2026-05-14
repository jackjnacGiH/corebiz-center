-- =========================================================================
-- 0007_loyalty_points.sql
-- 1 loyalty point per 100 THB. Auto-award on order.payment_status='paid'.
-- =========================================================================

create table public.loyalty_transactions (
  id          uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.customers on delete cascade,
  points      int not null,
  reason      text not null check (reason in ('earn_order','redeem','adjust','expire','signup_bonus','referral')),
  reference_type text,
  reference_id   uuid,
  note        text,
  created_at  timestamptz not null default now()
);

create index loyalty_tx_customer_idx on public.loyalty_transactions(customer_id, created_at desc);

alter table public.loyalty_transactions enable row level security;

create policy loyalty_tx_staff_all on public.loyalty_transactions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create or replace function public.tg_order_paid_loyalty()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_points int;
begin
  if NEW.payment_status = 'paid'
     and (OLD.payment_status is null or OLD.payment_status <> 'paid')
     and NEW.customer_id is not null
     and NEW.status not in ('cancelled','returned') then

    v_points := floor(NEW.total / 100);

    if v_points > 0 then
      update public.customers
      set loyalty_points = loyalty_points + v_points
      where id = NEW.customer_id;

      insert into public.loyalty_transactions (customer_id, points, reason, reference_type, reference_id, note)
      values (NEW.customer_id, v_points, 'earn_order', 'order', NEW.id,
              'Order ' || NEW.code || ' ฿' || NEW.total::text);
    end if;

    perform public.recalculate_customer_totals(NEW.customer_id);
  end if;

  return NEW;
end;
$$;

drop trigger if exists order_paid_loyalty_trigger on public.orders;
create trigger order_paid_loyalty_trigger
  after update on public.orders
  for each row execute function public.tg_order_paid_loyalty();
