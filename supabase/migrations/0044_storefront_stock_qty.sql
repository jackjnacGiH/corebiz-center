-- Expose the available stock quantity on the public storefront view so the
-- shop can show "พร้อมขาย N". in_stock stays (qty > 0 → พร้อมส่ง; 0/none → สั่งผลิต).
-- Only the quantity is exposed — cost and raw per-warehouse rows remain hidden.
create or replace view public.storefront_products as
 select p.id, p.sku, p.name_th, p.name_en, p.description_th, p.description_en,
        p.brand, p.unit, p.price, p.discount_value, p.discount_type, p.weight_kg,
        p.images, p.spec, p.tags, p.feature_tags, p.is_featured, p.min_order_qty,
        p.created_at, p.updated_at,
        c.slug AS category_slug, c.name_th AS category_name_th, c.name_en AS category_name_en,
        p.group_id, g.name AS group_name,
        COALESCE((SELECT sum(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0::bigint) > 0 AS in_stock,
        COALESCE((SELECT sum(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0::bigint) AS stock_qty
   FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_groups g ON g.id = p.group_id
  WHERE p.status = 'active'::text;

grant select on public.storefront_products to anon, authenticated;
