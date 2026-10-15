-- Restore only the predicates changed by the performance migration.
begin;
set local lock_timeout='2s';
alter policy "categories_read_all" on public.categories using (can_read());
alter policy "categories_staff_all" on public.categories using (is_staff());
alter policy "customer_branches_read_all" on public.customer_branches using (can_read());
alter policy "customers_read_all" on public.customers using (can_read());
alter policy "customers_staff_all" on public.customers using (is_staff());
alter policy "inventory_read_all" on public.inventory using (can_read());
alter policy "inventory_staff_all" on public.inventory using (is_staff());
alter policy "notifications_read_all" on public.notifications using (can_read());
alter policy "product_groups_read_all" on public.product_groups using (can_read());
alter policy "products_read_all" on public.products using (can_read());
alter policy "products_staff_all" on public.products using (is_staff());
alter policy "warehouses_read_all" on public.warehouses using (can_read());
alter policy "warehouses_staff_all" on public.warehouses using (is_staff());
drop index if exists public.customers_spent_page_idx;
commit;
