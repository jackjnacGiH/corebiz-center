-- 0076_storefront_view_security_invoker.sql
--
-- Removes SECURITY DEFINER semantics from the public storefront view while
-- preserving its aggregate stock fields. Raw inventory rows stay private;
-- the narrowly-scoped helper reveals only total stock for active products.

create or replace function public.storefront_stock_qty(p_product_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(i.quantity), 0)::bigint
  from public.inventory i
  join public.products p on p.id = i.product_id
  where i.product_id = p_product_id
    and p.status = 'active';
$$;

revoke all on function public.storefront_stock_qty(uuid) from public;
grant execute on function public.storefront_stock_qty(uuid) to anon, authenticated;

create or replace view public.storefront_products
with (security_invoker = true)
as
select
  p.id,
  p.sku,
  p.name_th,
  p.name_en,
  p.description_th,
  p.description_en,
  p.brand,
  p.unit,
  p.price,
  p.discount_value,
  p.discount_type,
  p.weight_kg,
  p.images,
  p.spec,
  p.tags,
  p.feature_tags,
  p.is_featured,
  p.min_order_qty,
  p.created_at,
  p.updated_at,
  c.slug as category_slug,
  c.name_th as category_name_th,
  c.name_en as category_name_en,
  p.group_id,
  g.name as group_name,
  public.storefront_stock_qty(p.id) > 0 as in_stock,
  public.storefront_stock_qty(p.id) as stock_qty
from public.products p
left join public.categories c on c.id = p.category_id
left join public.product_groups g on g.id = p.group_id
where p.status = 'active';

revoke all on table public.storefront_products from public, anon, authenticated;
grant select on table public.storefront_products to anon, authenticated;
