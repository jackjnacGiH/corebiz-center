-- =========================================================================
-- 0046_agent_tasks.sql — AI Agent task queue (human-in-the-loop) + Ops scanner
-- =========================================================================
-- The backbone of the "AI Agent" system: every agent (sales / ops / content /
-- seo) writes its recommendations here as a task. Staff review them on the
-- AI Agent Dashboard and approve / reject / snooze / dismiss. Risky actions
-- (sending messages, converting quotes, publishing) are NEVER executed without
-- a human approving them first.
--
-- This migration also ships the first agent: agent_run_ops_scan() — a pure,
-- rule-based (no-LLM, no external calls) scanner that is 100% safe to run
-- unattended. It populates the queue with real operational recommendations.
-- =========================================================================

create table if not exists public.agent_tasks (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,                       -- 'sales' | 'ops' | 'content' | 'seo'
  kind              text not null,                       -- e.g. 'ops.restock', 'sales.quote_followup'
  action_kind       text not null default 'none',        -- what executing does: 'none','send_message','convert_quote','publish_article','update_kb'
  title             text not null,
  summary           text,
  recommendation    text,                                -- "แนะนำให้ทำ: ..."
  payload           jsonb not null default '{}'::jsonb,  -- structured data for display + execution
  status            text not null default 'proposed',    -- proposed,approved,rejected,executed,failed,dismissed,snoozed
  requires_approval boolean not null default true,        -- false = pure insight (acknowledge only)
  priority          smallint not null default 2,          -- 1 high, 2 normal, 3 low
  related_type      text,                                 -- 'order','quote','customer','product','inventory','conversation','cart','report'
  related_id        text,
  dedupe_key        text unique,                          -- prevents duplicate proposals across scans
  source            text not null default 'agent',        -- which agent produced it
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  executed_at       timestamptz,
  result            jsonb,
  error             text,
  snooze_until      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint agent_tasks_status_chk   check (status in ('proposed','approved','rejected','executed','failed','dismissed','snoozed')),
  constraint agent_tasks_category_chk check (category in ('sales','ops','content','seo')),
  constraint agent_tasks_priority_chk check (priority between 1 and 3)
);

create index if not exists agent_tasks_status_idx   on public.agent_tasks(status, priority, created_at desc);
create index if not exists agent_tasks_category_idx on public.agent_tasks(category, status);
create index if not exists agent_tasks_related_idx  on public.agent_tasks(related_type, related_id);

-- --------------------------------------------------------------------------
-- Triggers: stamp updated_at + reviewer on status change; auto-audit
-- --------------------------------------------------------------------------
create or replace function public.agent_tasks_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status is distinct from old.status
     and new.status in ('approved','rejected','dismissed','executed') then
    if new.reviewed_by is null then new.reviewed_by = auth.uid(); end if;
    if new.reviewed_at is null then new.reviewed_at = now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_tasks_biu on public.agent_tasks;
create trigger trg_agent_tasks_biu before update on public.agent_tasks
  for each row execute function public.agent_tasks_before_update();

create or replace function public.agent_tasks_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs(actor_id, action, target_type, target_id, detail)
    values (auth.uid(), 'agent_task_' || new.status, 'agent_task', new.id::text,
            jsonb_build_object('kind', new.kind, 'title', new.title,
                               'from', old.status, 'to', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_tasks_audit on public.agent_tasks;
create trigger trg_agent_tasks_audit after update on public.agent_tasks
  for each row execute function public.agent_tasks_audit();

-- --------------------------------------------------------------------------
-- RLS: staff read; can_write update/insert; can_delete delete
-- --------------------------------------------------------------------------
alter table public.agent_tasks enable row level security;

drop policy if exists agent_tasks_read   on public.agent_tasks;
drop policy if exists agent_tasks_update on public.agent_tasks;
drop policy if exists agent_tasks_insert on public.agent_tasks;
drop policy if exists agent_tasks_delete on public.agent_tasks;

create policy agent_tasks_read   on public.agent_tasks for select to authenticated using (public.is_staff());
create policy agent_tasks_update on public.agent_tasks for update to authenticated using (public.can_write()) with check (public.can_write());
create policy agent_tasks_insert on public.agent_tasks for insert to authenticated with check (public.can_write());
create policy agent_tasks_delete on public.agent_tasks for delete to authenticated using (public.can_delete());

-- --------------------------------------------------------------------------
-- agent_propose(): upsert a task with dedupe. Used by scanners & future agents.
-- security definer so edge functions / cron / definer functions can call it.
-- --------------------------------------------------------------------------
create or replace function public.agent_propose(
  p_category          text,
  p_kind              text,
  p_title             text,
  p_summary           text     default null,
  p_recommendation    text     default null,
  p_payload           jsonb    default '{}'::jsonb,
  p_action_kind       text     default 'none',
  p_requires_approval boolean  default true,
  p_priority          smallint default 2,
  p_related_type      text     default null,
  p_related_id        text     default null,
  p_dedupe_key        text     default null,
  p_source            text     default 'agent'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_dedupe_key is null then
    insert into public.agent_tasks(category,kind,title,summary,recommendation,payload,action_kind,
                                    requires_approval,priority,related_type,related_id,source)
    values (p_category,p_kind,p_title,p_summary,p_recommendation,coalesce(p_payload,'{}'::jsonb),p_action_kind,
            p_requires_approval,p_priority,p_related_type,p_related_id,p_source)
    returning id into v_id;
    return v_id;
  end if;

  insert into public.agent_tasks(category,kind,title,summary,recommendation,payload,action_kind,
                                  requires_approval,priority,related_type,related_id,dedupe_key,source)
  values (p_category,p_kind,p_title,p_summary,p_recommendation,coalesce(p_payload,'{}'::jsonb),p_action_kind,
          p_requires_approval,p_priority,p_related_type,p_related_id,p_dedupe_key,p_source)
  on conflict (dedupe_key) do update
    set title          = excluded.title,
        summary        = excluded.summary,
        recommendation = excluded.recommendation,
        payload        = excluded.payload,
        priority       = excluded.priority,
        updated_at     = now()
    where public.agent_tasks.status in ('proposed','snoozed')   -- only refresh still-open tasks
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.agent_tasks where dedupe_key = p_dedupe_key;
  end if;
  return v_id;
end;
$$;

-- --------------------------------------------------------------------------
-- agent_run_ops_scan(): rule-based Ops agent. NO LLM, NO external calls — only
-- reads data and proposes. 100% safe to run unattended (cron) or on demand.
-- --------------------------------------------------------------------------
create or replace function public.agent_run_ops_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  v_low int := 0; v_oos int := 0;
  v_restock_items jsonb;
  r record;
  v_today numeric; v_week numeric; v_open_quote_val numeric; v_unanswered int;
begin
  -- When invoked via RPC by a logged-in user, require staff. When run by cron
  -- (postgres, no JWT -> auth.uid() is null), allow.
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'not authorized';
  end if;

  -- 1) RESTOCK digest --------------------------------------------------------
  select count(*), count(*) filter (where avail <= 0)
    into v_low, v_oos
  from (
    select (i.quantity - coalesce(i.reserved,0)) as avail, coalesce(i.reorder_level,0) as rl
    from public.inventory i
    join public.products p on p.id = i.product_id
    where p.status = 'active' and coalesce(i.reorder_level,0) > 0
  ) q
  where q.avail <= q.rl;

  if v_low > 0 then
    select jsonb_agg(jsonb_build_object('sku',sku,'name',name_th,'available',avail,'reorder_level',rl) order by avail)
      into v_restock_items
    from (
      select p.sku, p.name_th,
             (i.quantity - coalesce(i.reserved,0)) as avail,
             coalesce(i.reorder_level,0) as rl
      from public.inventory i
      join public.products p on p.id = i.product_id
      where p.status = 'active' and coalesce(i.reorder_level,0) > 0
        and (i.quantity - coalesce(i.reserved,0)) <= coalesce(i.reorder_level,0)
      order by (i.quantity - coalesce(i.reserved,0)) asc
      limit 100
    ) t;

    perform public.agent_propose(
      'ops', 'ops.restock',
      format('สินค้า %s รายการต่ำกว่าจุดสั่งซื้อ (หมดสต็อก %s รายการ)', v_low, v_oos),
      format('มีสินค้า %s รายการที่จำนวนพร้อมขายต่ำกว่าหรือเท่ากับจุดสั่งซื้อ (reorder level); ในจำนวนนี้หมดสต็อกแล้ว %s รายการ', v_low, v_oos),
      'แนะนำให้สั่งซื้อ/เติมสต็อก โดยเฉพาะรายการที่หมดสต็อกก่อน',
      jsonb_build_object('items', coalesce(v_restock_items,'[]'::jsonb), 'low_count', v_low, 'oos_count', v_oos),
      'none', true, (case when v_oos > 0 then 1 else 2 end)::smallint,
      'inventory', null, 'ops.restock.digest', 'ops_scan'
    );
    v_count := v_count + 1;
  end if;

  -- 2) OUTSTANDING PAYMENT (shipped/delivered but unpaid) --------------------
  for r in
    select o.id, o.code, o.total, o.status, c.name as cust
    from public.orders o
    left join public.customers c on c.id = o.customer_id
    where o.payment_status = 'unpaid' and o.status in ('shipped','delivered')
  loop
    perform public.agent_propose(
      'ops', 'ops.outstanding_payment',
      format('ออเดอร์ %s ยังไม่ชำระเงิน (%s บาท)', r.code, to_char(coalesce(r.total,0),'FM999,999,990')),
      format('ออเดอร์ %s ของลูกค้า %s สถานะ %s แล้ว แต่ยังไม่ได้รับชำระเงิน ยอด %s บาท',
             r.code, coalesce(r.cust,'-'), r.status, to_char(coalesce(r.total,0),'FM999,999,990')),
      'แนะนำให้ติดตามการชำระเงินกับลูกค้า',
      jsonb_build_object('order_code',r.code,'total',r.total,'status',r.status,'customer',r.cust),
      'send_message', true, 1::smallint, 'order', r.id::text,
      'ops.outstanding_payment.' || r.id::text, 'ops_scan'
    );
    v_count := v_count + 1;
  end loop;

  -- 3) ACCEPTED quotes not yet converted ------------------------------------
  for r in
    select q.id, q.code, q.total, c.name as cust
    from public.quotes q
    left join public.customers c on c.id = q.customer_id
    where q.status = 'accepted' and q.converted_to_order_id is null
  loop
    perform public.agent_propose(
      'sales', 'sales.quote_convert',
      format('ใบเสนอราคา %s ตอบรับแล้ว — ยังไม่เปิดออเดอร์', r.code),
      format('ลูกค้า %s ตอบรับใบเสนอราคา %s (ยอด %s บาท) แล้ว แต่ยังไม่ถูกแปลงเป็นคำสั่งซื้อ',
             coalesce(r.cust,'-'), r.code, to_char(coalesce(r.total,0),'FM999,999,990')),
      'แนะนำให้แปลงใบเสนอราคาเป็นออเดอร์ และยืนยันกับลูกค้า',
      jsonb_build_object('quote_code',r.code,'total',r.total,'customer',r.cust),
      'convert_quote', true, 1::smallint, 'quote', r.id::text,
      'sales.quote_convert.' || r.id::text, 'ops_scan'
    );
    v_count := v_count + 1;
  end loop;

  -- 4) DRAFT quotes stale (> 7 days) ----------------------------------------
  for r in
    select q.id, q.code, q.total, q.created_at, c.name as cust
    from public.quotes q
    left join public.customers c on c.id = q.customer_id
    where q.status = 'draft' and q.converted_to_order_id is null
      and q.created_at < now() - interval '7 days'
  loop
    perform public.agent_propose(
      'sales', 'sales.quote_followup',
      format('ใบเสนอราคา %s ค้างนานเกิน 7 วัน', r.code),
      format('ใบเสนอราคา %s (ลูกค้า %s, ยอด %s บาท) ยังเป็นฉบับร่าง/ยังไม่ตอบรับ นานกว่า 7 วัน',
             r.code, coalesce(r.cust,'-'), to_char(coalesce(r.total,0),'FM999,999,990')),
      'แนะนำให้ติดตามลูกค้าเพื่อปิดการขาย',
      jsonb_build_object('quote_code',r.code,'total',r.total,'customer',r.cust,
                         'age_days', extract(day from now() - r.created_at)::int),
      'send_message', true, 2::smallint, 'quote', r.id::text,
      'sales.quote_followup.' || r.id::text, 'ops_scan'
    );
    v_count := v_count + 1;
  end loop;

  -- 5) ABANDONED CARTS (not recovered, > 1 day old) -------------------------
  for r in
    select ac.id, ac.cart_value, ac.email, ac.created_at, c.name as cust
    from public.abandoned_carts ac
    left join public.customers c on c.id = ac.customer_id
    where coalesce(ac.recovered,false) = false
      and ac.created_at < now() - interval '1 day'
  loop
    perform public.agent_propose(
      'sales', 'sales.abandoned_cart',
      format('ตะกร้าค้าง %s บาท', to_char(coalesce(r.cart_value,0),'FM999,999,990')),
      format('ลูกค้า %s ทิ้งตะกร้ามูลค่า %s บาทไว้ ยังไม่ได้กลับมาซื้อ',
             coalesce(r.cust,r.email,'-'), to_char(coalesce(r.cart_value,0),'FM999,999,990')),
      'แนะนำให้ส่งข้อความ/คูปองเชิญกลับมาซื้อ',
      jsonb_build_object('cart_value',r.cart_value,'customer',coalesce(r.cust,r.email)),
      'send_message', true, 2::smallint, 'cart', r.id::text,
      'sales.abandoned_cart.' || r.id::text, 'ops_scan'
    );
    v_count := v_count + 1;
  end loop;

  -- 6) UNANSWERED chat (open + unread, idle > 30 min) -----------------------
  for r in
    select cv.id, cv.channel, coalesce(cv.display_name, cv.alias_name, 'ลูกค้า') as nm,
           cv.unread_count, cv.last_message_preview
    from public.chat_conversations cv
    where cv.status = 'open' and coalesce(cv.unread_count,0) > 0
      and cv.last_customer_message_at is not null
      and cv.last_customer_message_at < now() - interval '30 minutes'
  loop
    perform public.agent_propose(
      'sales', 'sales.unanswered_chat',
      format('ลูกค้ารอตอบใน %s: %s', r.channel, r.nm),
      format('ลูกค้า %s (%s) มีข้อความค้าง %s ข้อความ ยังไม่ได้ตอบ', r.nm, r.channel, coalesce(r.unread_count,0)),
      'แนะนำให้เข้าไปตอบลูกค้าโดยเร็ว',
      jsonb_build_object('channel',r.channel,'name',r.nm,'unread',r.unread_count,'preview',r.last_message_preview),
      'none', false, 1::smallint, 'conversation', r.id::text,
      'sales.unanswered_chat.' || r.id::text, 'ops_scan'
    );
    v_count := v_count + 1;
  end loop;

  -- 7) DAILY REPORT digest (one per day) ------------------------------------
  select coalesce(sum(total) filter (where created_at::date = current_date), 0),
         coalesce(sum(total) filter (where created_at >= date_trunc('week', now())), 0)
    into v_today, v_week
  from public.orders where status not in ('cancelled','returned');

  select coalesce(sum(total),0) into v_open_quote_val
  from public.quotes where status in ('draft','sent');

  select count(*) into v_unanswered
  from public.chat_conversations where status = 'open' and coalesce(unread_count,0) > 0;

  perform public.agent_propose(
    'ops', 'ops.daily_report',
    format('สรุปประจำวัน %s', to_char(now(),'DD/MM/YYYY')),
    format('ยอดขายวันนี้ %s บาท · สัปดาห์นี้ %s บาท · ใบเสนอราคาค้าง %s บาท · สินค้าต่ำกว่าจุดสั่งซื้อ %s รายการ · แชทรอตอบ %s',
           to_char(v_today,'FM999,999,990'), to_char(v_week,'FM999,999,990'),
           to_char(v_open_quote_val,'FM999,999,990'), v_low, v_unanswered),
    null,
    jsonb_build_object('sales_today',v_today,'sales_week',v_week,'open_quote_value',v_open_quote_val,
                       'low_stock',v_low,'oos',v_oos,'unanswered_chats',v_unanswered),
    'none', false, 2::smallint, 'report', null,
    'ops.daily_report.' || to_char(now(),'YYYY-MM-DD'), 'ops_scan'
  );
  v_count := v_count + 1;

  return jsonb_build_object('ok', true, 'tasks_touched', v_count,
                            'low_stock', v_low, 'oos', v_oos, 'scanned_at', now());
end;
$$;

grant execute on function public.agent_run_ops_scan() to authenticated;
