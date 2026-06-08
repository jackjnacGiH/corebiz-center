-- Domain migration corebiz.online → jnac.online: point the storefront
-- on-demand revalidate ping at the new primary domain. (Apply this only after
-- jnac.online is live and serving /shop, or the ping 404s — harmless, ISR
-- still self-heals within the revalidate window, but keep it correct.)
create or replace function public.notify_storefront_revalidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://www.jnac.online/shop/api/revalidate?secret=corebiz_shop_revalidate_2026',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', TG_TABLE_NAME, 'op', TG_OP)
  );
  return null;
exception when others then
  return null; -- never let revalidation errors block the data change
end;
$$;

-- Trigger itself is unchanged (still bound to public.products).
