-- ── 1) SECURITY FIX: stop exposing products.cost (ราคาทุน) to anon ──────────
-- anon had table-wide SELECT (incl. cost). Switch to a column grant excluding
-- `cost`. Row visibility is still governed by products_public_read.
revoke select on public.products from anon;
grant select (
  id, sku, name_th, name_en, description_th, description_en, category_id,
  brand, unit, price, weight_kg, images, spec, tags, barcode, status, is_featured,
  created_at, updated_at, feature_tags, discount_value, discount_type, group_id, min_order_qty
) on public.products to anon;

-- ── 2) Public storefront view ───────────────────────────────────────────────
-- Safe columns + an availability boolean derived from inventory. security_invoker
-- = false so the inventory subquery runs as the view owner (anon can't read the
-- inventory table directly) and only the boolean — never raw quantities or cost —
-- is exposed.
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
  g.name    as group_name,
  (coalesce((select sum(i.quantity) from public.inventory i where i.product_id = p.id), 0) > 0) as in_stock
from public.products p
left join public.categories c on c.id = p.category_id
left join public.product_groups g on g.id = p.group_id
where p.status = 'active';

grant select on public.storefront_products to anon, authenticated;
