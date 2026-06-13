-- =========================================================================
-- 0059_system_reviews.sql — AI Monthly Review (สรุปผล + ข้อเสนอแนะ ทุก 30 วัน)
-- =========================================================================
-- A strategic layer on top of the existing agent_tasks engine. Every 30 days
-- (cron, 1st of month 09:00) an edge function:
--   1. calls agent_collect_review_metrics() to aggregate 30-day behaviour,
--   2. asks Gemini to turn the numbers into a Thai analysis + ranked
--      recommendations (rule-based fallback if Gemini is unavailable),
--   3. stores the result in public.system_reviews,
--   4. pushes a LINE summary to every LINE-linked owner/admin.
-- AI only *recommends*; the owner decides. Nothing here mutates the system.
-- =========================================================================

-- ---- store -------------------------------------------------------------
create table if not exists public.system_reviews (
  id uuid primary key default gen_random_uuid(),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  metrics       jsonb not null default '{}'::jsonb,
  headline      text,
  summary       text,
  recommendations jsonb not null default '[]'::jsonb,  -- [{priority,area,title,detail,effort}]
  generated_by  text not null default 'ai',            -- 'ai' | 'fallback'
  model         text,
  status        text not null default 'new' check (status in ('new','read','archived')),
  created_at    timestamptz not null default now()
);
create index if not exists system_reviews_created_idx on public.system_reviews(created_at desc);

alter table public.system_reviews enable row level security;
drop policy if exists system_reviews_staff_read  on public.system_reviews;
drop policy if exists system_reviews_owner_write on public.system_reviews;
create policy system_reviews_staff_read  on public.system_reviews for select to authenticated using (public.is_staff());
create policy system_reviews_owner_write on public.system_reviews for all    to authenticated using (public.is_owner()) with check (public.is_owner());

-- ---- behaviour aggregator ---------------------------------------------
-- Returns one jsonb blob of 30-day (default) behaviour & ops metrics.
-- Defensive: every figure is coalesced; unknown enum values simply count 0.
create or replace function public.agent_collect_review_metrics(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  return jsonb_build_object(
    'window_days', p_days,
    'period_start', v_from,
    'period_end', now(),

    'customers', jsonb_build_object(
      'total', (select count(*) from customers),
      'new',   (select count(*) from customers where created_at >= v_from),
      'by_tier', (select coalesce(jsonb_object_agg(tier, c), '{}'::jsonb)
                    from (select coalesce(tier,'-') tier, count(*) c from customers group by 1) s),
      'new_by_source', (select coalesce(jsonb_object_agg(src, c), '{}'::jsonb)
                    from (select coalesce(source_channel,'-') src, count(*) c
                            from customers where created_at >= v_from group by 1) s)
    ),

    'quotes', jsonb_build_object(
      'count',     (select count(*) from quotes where created_at >= v_from),
      'value',     (select coalesce(sum(total),0) from quotes where created_at >= v_from),
      'converted', (select count(*) from quotes where created_at >= v_from and converted_to_order_id is not null),
      'open',      (select count(*) from quotes
                      where converted_to_order_id is null
                        and coalesce(status,'') not in ('cancelled','rejected','expired')),
      'by_status', (select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
                    from (select coalesce(status,'-') status, count(*) c
                            from quotes where created_at >= v_from group by 1) s)
    ),

    'top_products', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select qi.product_name as name,
               sum(coalesce(qi.quantity,0)) as qty,
               count(distinct qi.quote_id) as quotes
          from quote_items qi join quotes q on q.id = qi.quote_id
         where q.created_at >= v_from and qi.product_name is not null
         group by qi.product_name
         order by qty desc nulls last
         limit 8) x),

    'chat', jsonb_build_object(
      'conversations', (select count(*) from chat_conversations where created_at >= v_from),
      'messages',      (select count(*) from chat_messages where created_at >= v_from),
      'by_channel', (select coalesce(jsonb_object_agg(channel, c), '{}'::jsonb)
                    from (select coalesce(channel,'-') channel, count(*) c
                            from chat_conversations where created_at >= v_from group by 1) s),
      'from_customer', (select count(*) from chat_messages where created_at >= v_from and sender_type = 'customer'),
      'from_bot',      (select count(*) from chat_messages where created_at >= v_from and sender_type in ('bot','assistant','ai')),
      'from_staff',    (select count(*) from chat_messages where created_at >= v_from and sender_type in ('staff','agent','admin')),
      'open_unassigned', (select count(*) from chat_conversations
                            where coalesce(status,'') not in ('closed','resolved') and assigned_to is null)
    ),

    'inventory', jsonb_build_object(
      'skus',         (select count(*) from inventory),
      'low_stock',    (select count(*) from inventory
                         where (quantity - coalesce(reserved,0)) <= coalesce(reorder_level,0)
                           and (quantity - coalesce(reserved,0)) > 0),
      'out_of_stock', (select count(*) from inventory where (quantity - coalesce(reserved,0)) <= 0)
    ),

    'satisfaction', jsonb_build_object(
      'responses', (select count(*) from surveys where answered_at >= v_from),
      'avg_score', (select round(avg(score)::numeric, 2) from surveys where answered_at >= v_from and score is not null)
    ),

    'agent_tasks', jsonb_build_object(
      'created',  (select count(*) from agent_tasks where created_at >= v_from),
      'approved', (select count(*) from agent_tasks where reviewed_at >= v_from and status in ('approved','executed')),
      'rejected', (select count(*) from agent_tasks where reviewed_at >= v_from and status = 'rejected'),
      'by_kind',  (select coalesce(jsonb_object_agg(kind, c), '{}'::jsonb)
                    from (select kind, count(*) c from agent_tasks where created_at >= v_from group by 1) s)
    ),

    'loyalty_points_awarded', (select coalesce(sum(points),0) from loyalty_transactions where created_at >= v_from)
  );
end;
$$;

revoke execute on function public.agent_collect_review_metrics(int) from public, anon;
grant  execute on function public.agent_collect_review_metrics(int) to authenticated, service_role;

-- ---- trigger plumbing (cron + manual) ---------------------------------
-- Internal: fire-and-forget POST to the monthly-review edge function.
-- No auth check — only callable by definer (postgres) and service_role / cron.
create or replace function public.agent_run_monthly_review_internal(p_days int default 30)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/monthly-review',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-review-key', 'corebiz_monthly_review_2026_r9m4'),
    body := jsonb_build_object('days', p_days)
  );
exception when others then
  null; -- never raise from a scheduled job
end;
$$;
revoke execute on function public.agent_run_monthly_review_internal(int) from public, anon, authenticated;
grant  execute on function public.agent_run_monthly_review_internal(int) to service_role;

-- Owner-facing: lets the "สร้างรายงานเดี๋ยวนี้" button trigger a review on demand.
create or replace function public.agent_request_monthly_review()
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  perform public.agent_run_monthly_review_internal(30);
  return 'queued';
end;
$$;
revoke execute on function public.agent_request_monthly_review() from public, anon;
grant  execute on function public.agent_request_monthly_review() to authenticated;

-- ---- schedule: 1st of every month, 09:00 (≈ every 30 days) -------------
do $$ begin
  perform cron.unschedule('agent-monthly-review');
exception when others then null; end $$;
select cron.schedule('agent-monthly-review', '0 9 1 * *',
  $$ select public.agent_run_monthly_review_internal(30); $$);
