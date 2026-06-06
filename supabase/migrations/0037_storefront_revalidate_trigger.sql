-- When product data changes in คลังสินค้า, ping the storefront's on-demand
-- revalidate endpoint so corebiz.online/shop reflects it immediately (instead
-- of waiting for the ISR window). Statement-level so a bulk sync fires once.
-- Fire-and-forget via pg_net; failures never block the write.
create or replace function public.notify_storefront_revalidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://www.corebiz.online/shop/api/revalidate?secret=corebiz_shop_revalidate_2026',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', TG_TABLE_NAME, 'op', TG_OP)
  );
  return null;
exception when others then
  return null; -- never let revalidation errors block the data change
end;
$$;

drop trigger if exists trg_products_revalidate on public.products;
create trigger trg_products_revalidate
  after insert or update or delete on public.products
  for each statement
  execute function public.notify_storefront_revalidate();