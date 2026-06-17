-- =========================================================================
-- 0068_quote_custom_shipping_lines.sql
-- Allow non-product line items on quotes/orders (custom free-text lines +
-- shipping fee) that don't touch stock or Inventory.
-- =========================================================================
-- These lines have product_id = null. Inventory must ignore them:
--   • the stock UPDATE in tg_order_status_inventory joins on product_id, so a
--     null line never matches — already safe.
--   • but the inventory_movements INSERT iterated every order_item, which would
--     fail (movements.product_id NOT NULL) or log a junk movement. Guard it
--     with "product_id is not null".
-- =========================================================================

alter table public.quote_items alter column product_id drop not null;
alter table public.order_items alter column product_id drop not null;

create or replace function public.tg_order_status_inventory()
returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_default_warehouse uuid;
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  select id into v_default_warehouse
  from public.warehouses where is_default = true limit 1;
  if v_default_warehouse is null then
    return NEW;   -- no warehouse configured; skip silently
  end if;

  -- Commit: status moves into committed set
  if NEW.status in ('processing','shipped','delivered')
     and OLD.status not in ('processing','shipped','delivered') then

    update public.inventory inv
    set quantity = greatest(0, inv.quantity - oi.quantity)
    from public.order_items oi
    where oi.order_id = NEW.id
      and oi.product_id is not null
      and inv.product_id = oi.product_id
      and inv.warehouse_id = v_default_warehouse;

    insert into public.inventory_movements (
      product_id, warehouse_id, movement_type, quantity,
      reference_type, reference_id, note
    )
    select oi.product_id, v_default_warehouse, 'out', -oi.quantity,
           'order', NEW.id, 'Stock out: ' || NEW.code
    from public.order_items oi
    where oi.order_id = NEW.id
      and oi.product_id is not null;
  end if;

  -- Restore: from committed back to cancelled/returned
  if NEW.status in ('cancelled','returned')
     and OLD.status in ('processing','shipped','delivered') then

    update public.inventory inv
    set quantity = inv.quantity + oi.quantity
    from public.order_items oi
    where oi.order_id = NEW.id
      and oi.product_id is not null
      and inv.product_id = oi.product_id
      and inv.warehouse_id = v_default_warehouse;

    insert into public.inventory_movements (
      product_id, warehouse_id, movement_type, quantity,
      reference_type, reference_id, note
    )
    select oi.product_id, v_default_warehouse, 'in', oi.quantity,
           'order_return', NEW.id, 'Stock restore: ' || NEW.code
    from public.order_items oi
    where oi.order_id = NEW.id
      and oi.product_id is not null;
  end if;

  return NEW;
end;
$function$;
