-- =========================================================================
-- 0001_sample_data.sql — sample products/customers/orders for Phase 1
-- (NOT a migration — run manually via SQL Editor to repopulate)
-- =========================================================================

do $$
declare
  v_warehouse_id uuid;
  v_cat_abrasives uuid;
  v_cat_cutting uuid;
  v_cat_grinding uuid;
  v_cat_polishing uuid;
  v_cat_pneumatic uuid;
  v_cat_safety uuid;
  v_product_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
begin
  select id into v_warehouse_id from public.warehouses where code = 'MAIN';
  select id into v_cat_abrasives from public.categories where slug = 'abrasives';
  select id into v_cat_cutting from public.categories where slug = 'cutting';
  select id into v_cat_grinding from public.categories where slug = 'grinding';
  select id into v_cat_polishing from public.categories where slug = 'polishing';
  select id into v_cat_pneumatic from public.categories where slug = 'pneumatic-tools';
  select id into v_cat_safety from public.categories where slug = 'safety';

  with products_seed as (
    insert into public.products (sku, name_th, name_en, category_id, brand, unit, price, cost, status, tags, description_th)
    values
      ('ABR-001', 'กระดาษทรายกลม 5" #220 หลังสักหลาด', 'Velcro Sanding Disc 5" #220', v_cat_abrasives, 'Norton', 'ชิ้น', 15, 9, 'active', ARRAY['abrasives','sandpaper','grit-220'], 'กระดาษทรายกลม 5 นิ้ว #220 หลังตีนตุ๊กแก ใช้กับเครื่องขัดกลม'),
      ('ABR-002', 'กระดาษทรายกลม 5" #400 หลังสักหลาด', 'Velcro Sanding Disc 5" #400', v_cat_abrasives, 'Norton', 'ชิ้น', 18, 11, 'active', ARRAY['abrasives','sandpaper','grit-400'], 'กระดาษทรายกลม 5 นิ้ว #400 หลังตีนตุ๊กแก เหมาะกับการขัดละเอียด'),
      ('CUT-001', 'ใบตัดเหล็ก 4" หนา 1.0mm (กล่อง 10 ใบ)', 'Cutting Disc 4" 1.0mm (Box of 10)', v_cat_cutting, 'Bosch', 'กล่อง', 240, 165, 'active', ARRAY['cutting','metal'], 'ใบตัดเหล็กบาง ตัดเร็ว ใช้กับเครื่องเจียร 4 นิ้ว'),
      ('CUT-002', 'ใบตัดสแตนเลส 4" หนา 1.2mm', 'Stainless Cutting Disc 4" 1.2mm', v_cat_cutting, '3M', 'ชิ้น', 35, 22, 'active', ARRAY['cutting','stainless'], 'ใบตัดสแตนเลสคุณภาพสูง ไม่ทำให้ผิวเปลี่ยนสี'),
      ('GRN-001', 'ใบเจียรเหล็ก 4" หนา 6mm', 'Grinding Wheel 4" 6mm', v_cat_grinding, 'Bosch', 'ชิ้น', 45, 28, 'active', ARRAY['grinding','metal'], 'ใบเจียรเหล็ก 4 นิ้ว ทนทาน ใช้งานหนักได้'),
      ('GRN-002', 'จานเจียรหน้าผ้า 5"', 'Flap Disc 5"', v_cat_grinding, 'Klingspor', 'ชิ้น', 65, 42, 'active', ARRAY['grinding','flap-disc'], 'จานเจียรหน้าผ้าเอนกประสงค์ ใช้ทั้งเจียรและขัด'),
      ('POL-001', 'ผ้าขัดเงา 8" สำหรับขัดสีรถ', 'Polishing Pad 8" for Car Paint', v_cat_polishing, '3M', 'ชิ้น', 320, 220, 'active', ARRAY['polishing','car-care'], 'ผ้าขัดเงาสำหรับขัดเงาสีรถยนต์'),
      ('PNE-001', 'สว่านลม 1/2"', 'Air Drill 1/2"', v_cat_pneumatic, 'Ingersoll Rand', 'ชิ้น', 2890, 2150, 'active', ARRAY['pneumatic','drill'], 'สว่านลม 1/2 นิ้ว ใช้งานหนักได้ ใช้กับ Air Compressor'),
      ('PNE-002', 'เครื่องเจียรลม 4"', 'Air Grinder 4"', v_cat_pneumatic, 'Ingersoll Rand', 'ชิ้น', 3450, 2580, 'active', ARRAY['pneumatic','grinder'], 'เครื่องเจียรลม 4 นิ้ว แรงสูง น้ำหนักเบา'),
      ('SAF-001', 'แว่นตานิรภัย PPE', 'Safety Glasses PPE', v_cat_safety, '3M', 'ชิ้น', 89, 55, 'active', ARRAY['safety','ppe'], 'แว่นตานิรภัยมาตรฐาน ANSI Z87+'),
      ('SAF-002', 'ถุงมือหนังแท้ทนความร้อน', 'Heat-Resistant Leather Gloves', v_cat_safety, '3M', 'คู่', 120, 78, 'active', ARRAY['safety','gloves'], 'ถุงมือหนังแท้ ทนความร้อน 300°C เหมาะกับงานเชื่อม')
    returning id, sku
  )
  insert into public.inventory (product_id, warehouse_id, quantity, reorder_level, shelf)
  select p.id, v_warehouse_id,
    case p.sku
      when 'ABR-001' then 1500 when 'ABR-002' then 980
      when 'CUT-001' then 85   when 'CUT-002' then 320
      when 'GRN-001' then 8    when 'GRN-002' then 45
      when 'POL-001' then 22   when 'PNE-001' then 4
      when 'PNE-002' then 7    when 'SAF-001' then 200
      when 'SAF-002' then 0    end,
    10,
    case p.sku
      when 'ABR-001' then 'A1' when 'ABR-002' then 'A1'
      when 'CUT-001' then 'B2' when 'CUT-002' then 'B2'
      when 'GRN-001' then 'C1' when 'GRN-002' then 'C1'
      when 'POL-001' then 'D1' when 'PNE-001' then 'E1'
      when 'PNE-002' then 'E1' when 'SAF-001' then 'F1'
      when 'SAF-002' then 'F1' end
  from products_seed p;

  insert into public.customers (code, name, customer_type, tier, email, phone, total_spent, total_orders, tags, source_channel)
  values
    ('CUS-001', 'บจก. ก่อสร้างไทย', 'company', 'vip', 'contact@korsangthai.com', '02-123-4567', 525000, 18, ARRAY['contractor','bangkok'], 'sales'),
    ('CUS-002', 'อู่ช่างแมว', 'individual', 'gold', 'changmeow@gmail.com', '081-987-6543', 215000, 24, ARRAY['auto-repair'], 'walk-in'),
    ('CUS-003', 'ร้านสมชายวัสดุภัณฑ์', 'company', 'silver', 'somchai.wat@hotmail.com', '089-111-2222', 85000, 12, ARRAY['reseller'], 'sales'),
    ('CUS-004', 'นาย เจตน์ งานไม้', 'individual', 'general', 'jet.wood@gmail.com', '085-555-4444', 4500, 3, ARRAY['woodworking'], 'web'),
    ('CUS-005', 'บริษัท เจริญการช่าง จำกัด', 'company', 'gold', 'admin@charoenkarnchang.co.th', '02-555-7788', 320000, 28, ARRAY['contractor','industrial'], 'sales');

  -- Orders + items
  select id into v_customer_id from public.customers where code = 'CUS-001';
  insert into public.orders (code, customer_id, status, payment_status, subtotal, vat, total, channel)
  values ('ORD-2026-0001', v_customer_id, 'delivered', 'paid', 4205, 295, 4500, 'web')
  returning id into v_order_id;

  select id into v_product_id from public.products where sku = 'CUT-001';
  insert into public.order_items (order_id, product_id, sku, product_name, quantity, unit_price, total)
  values (v_order_id, v_product_id, 'CUT-001', 'ใบตัดเหล็ก 4" หนา 1.0mm (กล่อง 10 ใบ)', 10, 240, 2400);
  select id into v_product_id from public.products where sku = 'GRN-001';
  insert into public.order_items (order_id, product_id, sku, product_name, quantity, unit_price, total)
  values (v_order_id, v_product_id, 'GRN-001', 'ใบเจียรเหล็ก 4" หนา 6mm', 40, 45, 1800);

  select id into v_customer_id from public.customers where code = 'CUS-002';
  insert into public.orders (code, customer_id, status, payment_status, subtotal, vat, total, channel)
  values ('ORD-2026-0002', v_customer_id, 'shipped', 'paid', 1168, 82, 1250, 'line')
  returning id into v_order_id;
  select id into v_product_id from public.products where sku = 'ABR-001';
  insert into public.order_items (order_id, product_id, sku, product_name, quantity, unit_price, total)
  values (v_order_id, v_product_id, 'ABR-001', 'กระดาษทรายกลม 5" #220 หลังสักหลาด', 50, 15, 750);

  select id into v_customer_id from public.customers where code = 'CUS-003';
  insert into public.orders (code, customer_id, status, payment_status, subtotal, vat, total, channel)
  values ('ORD-2026-0003', v_customer_id, 'processing', 'unpaid', 8317, 583, 8900, 'web');

  select id into v_customer_id from public.customers where code = 'CUS-005';
  insert into public.orders (code, customer_id, status, payment_status, subtotal, vat, total, channel)
  values ('ORD-2026-0004', v_customer_id, 'pending', 'unpaid', 14206, 994, 15200, 'sales');
end$$;
