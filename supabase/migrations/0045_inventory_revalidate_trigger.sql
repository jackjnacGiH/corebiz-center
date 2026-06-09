-- The storefront stock ("พร้อมขาย N") is sum(inventory.quantity). The existing
-- revalidate trigger only fired on the products table, so editing stock in
-- คลังสินค้า didn't refresh the shop until the 5-min ISR window. Fire the same
-- revalidate on inventory changes too → stock on the shop updates immediately.
drop trigger if exists trg_inventory_revalidate on public.inventory;
create trigger trg_inventory_revalidate
  after insert or update or delete on public.inventory
  for each statement
  execute function public.notify_storefront_revalidate();
