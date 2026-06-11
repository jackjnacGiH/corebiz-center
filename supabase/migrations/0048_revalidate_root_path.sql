-- =========================================================================
-- 0048_revalidate_root_path.sql — storefront moved from /shop to site root
-- =========================================================================
-- The storefront now serves at https://www.jnac.online/ (basePath ""), so its
-- on-demand revalidate endpoint is /api/revalidate (was /shop/api/revalidate).
-- =========================================================================
create or replace function public.notify_storefront_revalidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://www.jnac.online/api/revalidate?secret=corebiz_shop_revalidate_2026',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', TG_TABLE_NAME, 'op', TG_OP)
  );
  return null;
exception when others then
  return null;
end;
$$;
