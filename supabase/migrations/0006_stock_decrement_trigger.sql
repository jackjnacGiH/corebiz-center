-- =========================================================================
-- 0006_stock_decrement_trigger.sql
-- Stock auto-decrement / restore on order status transitions.
--   * processing/shipped/delivered ← (uncommitted)  : decrement + log
--   * cancelled/returned          ← committed       : restore + log
-- Uses default warehouse.
-- =========================================================================

create or replace function public.tg_order_status_inventory()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_default_warehouse uuid;
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  select id into v_default_warehouse
  from public.warehouses where is_default = true limit 1;
  if v_default_warehouse is null then
    return NEW;
  end if;

  if NEW.status in ('processing','shipped','delivered')
     and OLD.status not in ('processing','shipped','delivered') then
    update public.inventory inv
    set quantity = greatest(0, inv.quantity - oi.quantity)
    from public.order_items oi
    where oi.order_id = NEW.id
      and inv.product_id = oi.product_id
      and inv.warehouse_id = v_default_warehouse;

    insert into public.inventory_movements (
      product_id, warehouse_id, movement_type, quantity,
      reference_type, reference_id, note
    )
    select oi.product_id, v_default_warehouse, 'out', -oi.quantity,
           'order', NEW.id, 'Stock out: ' || NEW.code
    from public.order_items oi
    where oi.order_id = NEW.id;
  end if;

  if NEW.status in ('cancelled','returned')
     and OLD.status in ('processing','shipped','delivered') then
    update public.inventory inv
    set quantity = inv.quantity + oi.quantity
    from public.order_items oi
    where oi.order_id = NEW.id
      and inv.product_id = oi.product_id
      and inv.warehouse_id = v_default_warehouse;

    insert into public.inventory_movements (
      product_id, warehouse_id, movement_type, quantity,
      reference_type, reference_id, note
    )
    select oi.product_id, v_default_warehouse, 'in', oi.quantity,
           'order_return', NEW.id, 'Stock restore: ' || NEW.code
    from public.order_items oi
    where oi.order_id = NEW.id;
  end if;

  return NEW;
end;
$$;

drop trigger if exists order_status_inventory_trigger on public.orders;
create trigger order_status_inventory_trigger
  after update of status on public.orders
  for each row execute function public.tg_order_status_inventory();
