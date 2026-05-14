-- =========================================================================
-- 0005_enable_realtime.sql
-- Adds public tables to the `supabase_realtime` publication so the
-- frontend can subscribe via supabase.channel().on('postgres_changes').
-- =========================================================================

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.inventory;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.products;
