-- 0075_omnichat_grants_and_indexes.sql
--
-- Removes obsolete Data API grants left behind after livechat moved to the
-- session-scoped RPC. RLS already denied rows, but revoking the grants also
-- removes these objects from the anonymous GraphQL schema.
-- Tightens the public storefront view to SELECT-only and adds missing FK
-- indexes reported by the Supabase performance advisor.

revoke all on table public.chat_conversations from anon;
revoke all on table public.chat_messages from anon;
revoke all on table public.chat_contact_notes from anon;
revoke all on table public.chat_quick_reply_templates from anon;
revoke all on table public.knowledge_chunks from anon;

-- storefront_products is intentionally a tightly constrained public view of
-- active products. It needs definer semantics because raw inventory rows are
-- private, but the view itself must never expose write privileges.
revoke all on table public.storefront_products from anon, authenticated;
grant select on table public.storefront_products to anon, authenticated;

create index if not exists chat_conversations_customer_id_idx
  on public.chat_conversations (customer_id)
  where customer_id is not null;

create index if not exists chat_messages_sender_id_idx
  on public.chat_messages (sender_id)
  where sender_id is not null;
