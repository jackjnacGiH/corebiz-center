-- =========================================================================
-- 0002_security_hardening.sql
-- Fixes Supabase advisor warnings from 0001_initial_schema:
--   - function_search_path_mutable (set_updated_at, recalculate_customer_totals, match_knowledge)
--   - anon/authenticated SECURITY DEFINER executable (handle_new_user)
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.recalculate_customer_totals(p_customer_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_total_spent numeric(14,2);
  v_total_orders int;
  v_new_tier text;
begin
  select coalesce(sum(total), 0), count(*)
  into v_total_spent, v_total_orders
  from public.orders
  where customer_id = p_customer_id
    and status not in ('cancelled','returned')
    and payment_status = 'paid';

  v_new_tier := case
    when v_total_spent >= 500000 then 'vip'
    when v_total_spent >= 200000 then 'gold'
    when v_total_spent >= 50000  then 'silver'
    else 'general'
  end;

  update public.customers
  set total_spent = v_total_spent,
      total_orders = v_total_orders,
      tier = v_new_tier
  where id = p_customer_id;
end;
$$;

create or replace function public.match_knowledge(
  query_embedding   vector(1024),
  match_threshold   float default 0.65,
  match_count       int default 5,
  filter_language   text default null,
  filter_visibility text default 'public'
)
returns table (
  id          uuid,
  title       text,
  content     text,
  source_path text,
  metadata    jsonb,
  tags        text[],
  similarity  float
)
language sql
stable
set search_path = public
as $$
  select
    kc.id,
    kc.title,
    kc.content,
    kc.source_path,
    kc.metadata,
    kc.tags,
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.embedding is not null
    and (filter_language is null or kc.language = filter_language)
    and (filter_visibility is null or kc.visibility = filter_visibility)
    and 1 - (kc.embedding <=> query_embedding) > match_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(vector, float, int, text, text) from public, anon;
grant execute on function public.match_knowledge(vector, float, int, text, text) to authenticated;

-- handle_new_user is meant for trigger only — block RPC calls
revoke execute on function public.handle_new_user() from anon, authenticated, public;
