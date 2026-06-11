-- =========================================================================
-- 0056_security_hardening.sql — close authenticated-but-customer holes
-- =========================================================================
-- The customer portal made role 'customer' an *authenticated* user. Several
-- policies/grants from the staff-only era assumed authenticated == staff:
--
--   • ai_personas: ANY authenticated user could read AND rewrite the bot's
--     system prompt (insert/update/select with qual true).
--   • quick_links: ALL with qual true.
--   • knowledge_categories: select true.
--   • storage 'products': any authenticated user could upload/replace/delete
--     product images; 'knowledge-assets': write/delete with just
--     auth.uid() IS NOT NULL.
--   • storage SELECT policies on all 4 public buckets let anon LIST bucket
--     contents (advisor: Public Bucket Allows Listing). Public-URL serving
--     does not need these policies — only the list() API does, which no app
--     code uses for anon. Restrict listing to staff.
--   • Internal security-definer functions executable by public/anon.
--   • 4 trigger functions without a pinned search_path.
-- =========================================================================

-- ── ai_personas: staff only ────────────────────────────────────────────────
drop policy if exists ai_personas_select_auth on public.ai_personas;
drop policy if exists ai_personas_insert_auth on public.ai_personas;
drop policy if exists ai_personas_update_auth on public.ai_personas;
create policy ai_personas_select_staff on public.ai_personas
  for select to authenticated using (public.is_staff());
create policy ai_personas_insert_staff on public.ai_personas
  for insert to authenticated with check (public.is_staff());
create policy ai_personas_update_staff on public.ai_personas
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- ── quick_links: staff only ────────────────────────────────────────────────
drop policy if exists quick_links_staff_all on public.quick_links;
create policy quick_links_staff_all on public.quick_links
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ── knowledge_categories: staff read ───────────────────────────────────────
drop policy if exists knowledge_categories_select on public.knowledge_categories;
create policy knowledge_categories_select on public.knowledge_categories
  for select to authenticated using (public.is_staff());

-- ── storage: products bucket writes → staff only ───────────────────────────
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can update product images" on storage.objects;
drop policy if exists "Authenticated users can delete product images" on storage.objects;
create policy "products staff insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'products' and public.is_staff());
create policy "products staff update" on storage.objects
  for update to authenticated using (bucket_id = 'products' and public.is_staff());
create policy "products staff delete" on storage.objects
  for delete to authenticated using (bucket_id = 'products' and public.is_staff());

-- ── storage: knowledge-assets writes → staff only ──────────────────────────
drop policy if exists knowledge_assets_staff_write on storage.objects;
drop policy if exists knowledge_assets_staff_delete on storage.objects;
create policy knowledge_assets_staff_write on storage.objects
  for insert to authenticated with check (bucket_id = 'knowledge-assets' and public.is_staff());
create policy knowledge_assets_staff_delete on storage.objects
  for delete to authenticated using (bucket_id = 'knowledge-assets' and public.is_staff());

-- ── storage: bucket LISTING → staff only (public URLs unaffected) ──────────
drop policy if exists "Public can view product images" on storage.objects;
drop policy if exists "chat-attachments public read" on storage.objects;
drop policy if exists "knowledge_assets_public_read" on storage.objects;
drop policy if exists "product-groups public read" on storage.objects;
create policy "buckets staff list" on storage.objects
  for select to authenticated
  using (bucket_id in ('products','chat-attachments','knowledge-assets','product-groups')
         and public.is_staff());

-- ── internal functions: not callable by anon/public ────────────────────────
-- Signatures resolved from pg_proc so the revoke can't miss on arg types.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('agent_propose','agent_run_ops_scan','search_products_fuzzy',
        'agent_tasks_audit','notify_storefront_revalidate','tg_notify_low_stock',
        'tg_notify_new_customer','tg_notify_new_order','tg_order_paid_grant_points',
        'tg_org_settings_touch','trigger_inventory_sync')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.proname in ('agent_propose','agent_run_ops_scan','search_products_fuzzy') then
      -- still used by edge functions (service role) and admin UI (staff)
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    else
      -- pure trigger functions: nobody calls these directly
      execute format('revoke execute on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;

-- ── pin search_path on flagged trigger functions ────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'agent_tasks_before_update', 'touch_keyword_synonyms_updated_at',
    'set_ai_personas_updated_at', 'line_channels_touch_updated_at'
  ] loop
    begin
      execute format('alter function public.%I() set search_path = public', f);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
