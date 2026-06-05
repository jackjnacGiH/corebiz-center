-- Add group_id to the public storefront view so the shop can browse by
-- product group (กลุ่มสินค้า) like the admin Industrial Product Catalog.
drop view if exists public.storefront_products;
create view public.storefront_products
  with (security_invoker = false) as
select
  p.id, p.sku, p.name_th, p.name_en, p.description_th, p.description_en,
  p.brand, p.unit, p.price, p.discount_value, p.discount_type,
  p.weight_kg, p.images, p.spec, p.tags, p.feature_tags, p.is_featured,
  p.min_order_qty, p.created_at, p.updated_at,
  c.slug    as category_slug,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  p.group_id,
  g.name    as group_name,
  (coalesce((select sum(i.quantity) from public.inventory i where i.product_id = p.id), 0) > 0) as in_stock
from public.products p
left join public.categories c on c.id = p.category_id
left join public.product_groups g on g.id = p.group_id
where p.status = 'active';

grant select on public.storefront_products to anon, authenticated;
