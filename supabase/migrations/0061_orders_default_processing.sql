-- =========================================================================
-- 0061_orders_default_processing.sql
-- Orders should never sit in "รอดำเนินการ" (pending) — that tab is for
-- ใบเสนอราคา (quotes) awaiting approval. A quote, once approved, becomes an
-- order that starts at "กำลังเตรียม" (processing). approveAsOrder already sets
-- 'processing' explicitly; this changes the column default so any other/future
-- order-creation path can't accidentally land an order back in pending.
-- ('pending' stays a valid status in the check constraint, just not the default.)
-- =========================================================================

alter table public.orders alter column status set default 'processing';
