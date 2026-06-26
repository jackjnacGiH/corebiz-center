-- =========================================================================
-- 0072_customer_type_add_shop_unspecified.sql
--
-- Expand the customers_customer_type_check constraint to include 'shop' and
-- 'unspecified' — matching the four options available in the frontend
-- CustomerModal dropdown (นิติบุคคล / ร้านค้า / บุคคล / ไม่ระบุ).
--
-- Safe: existing rows with 'individual' or 'company' are unaffected.
-- =========================================================================

ALTER TABLE public.customers
  DROP CONSTRAINT customers_customer_type_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check
    CHECK (customer_type = ANY (ARRAY[
      'individual'::text,
      'company'::text,
      'shop'::text,
      'unspecified'::text
    ]));
