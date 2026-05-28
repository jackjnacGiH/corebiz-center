-- =========================================================================
-- 0011_chat_contact_panel.sql
-- Contact panel (LINE OA style) — alias name, notes, auto-tagging
-- =========================================================================
-- Depends on: 0001_initial_schema (profiles, customers, orders)
--             0009_omni_chat_tables (chat_conversations, chat_messages)
--
-- Note: Packer = chat_conversations.assigned_to (existing column).
--       This migration adds: alias_name, auto_tags, billing/shipping
--       address snapshots, last_customer_message_at, and chat_contact_notes.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Extend chat_conversations
-- -------------------------------------------------------------------------
alter table public.chat_conversations
  add column if not exists alias_name               text,
  add column if not exists auto_tags                text[] not null default '{}',
  add column if not exists billing_address          jsonb,
  add column if not exists shipping_address         jsonb,
  add column if not exists last_customer_message_at timestamptz;

create index if not exists chat_conv_last_customer_msg_idx
  on public.chat_conversations(last_customer_message_at desc nulls last);

create index if not exists chat_conv_auto_tags_idx
  on public.chat_conversations using gin (auto_tags);

-- Backfill: ตั้งค่า last_customer_message_at จาก existing customer messages
update public.chat_conversations c
set last_customer_message_at = sub.max_at
from (
  select conversation_id, max(created_at) as max_at
  from public.chat_messages
  where sender_type = 'customer'
  group by conversation_id
) sub
where sub.conversation_id = c.id
  and c.last_customer_message_at is null;

-- -------------------------------------------------------------------------
-- 2) chat_contact_notes — โน้ตไม่จำกัด
-- -------------------------------------------------------------------------
create table if not exists public.chat_contact_notes (
  id               uuid primary key default uuid_generate_v4(),
  conversation_id  uuid not null references public.chat_conversations on delete cascade,
  note_type        text not null default 'general'
                     check (note_type in (
                       'general',        -- ทั่วไป (free-form)
                       'tax_invoice',    -- ใบกำกับภาษี
                       'shipping',       -- ที่อยู่ส่งของ
                       'reminder',       -- เตือนความจำ
                       'bank_account',   -- บัญชีธนาคาร
                       'special_terms'   -- สิทธิพิเศษ/ส่วนลด
                     )),
  title            text,
  content          text,
  address          jsonb,            -- tax_invoice / shipping
  due_date         timestamptz,      -- reminder
  metadata         jsonb not null default '{}'::jsonb,
  tags             text[] not null default '{}',
  is_pinned        boolean not null default false,
  created_by       uuid references auth.users on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists chat_notes_conv_idx
  on public.chat_contact_notes(conversation_id, created_at desc);

create index if not exists chat_notes_type_idx
  on public.chat_contact_notes(note_type);

create index if not exists chat_notes_pinned_idx
  on public.chat_contact_notes(conversation_id, is_pinned)
  where is_pinned = true;

create trigger set_updated_at_chat_contact_notes
  before update on public.chat_contact_notes
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- 3) Trigger: update last_customer_message_at เมื่อ sender='customer'
-- -------------------------------------------------------------------------
create or replace function public.tg_track_customer_message()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.sender_type = 'customer' then
    update public.chat_conversations
    set last_customer_message_at = NEW.created_at
    where id = NEW.conversation_id
      and (last_customer_message_at is null
           or last_customer_message_at < NEW.created_at);
  end if;
  return NEW;
end;
$$;

drop trigger if exists track_customer_message_trigger on public.chat_messages;
create trigger track_customer_message_trigger
  after insert on public.chat_messages
  for each row execute function public.tg_track_customer_message();

-- -------------------------------------------------------------------------
-- 4) recalc_chat_auto_tags(conversation_id) — คำนวณ auto_tags 1 conversation
-- -------------------------------------------------------------------------
create or replace function public.recalc_chat_auto_tags(p_conv_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_customer_id    uuid;
  v_total_orders   int;
  v_tier           text;
  v_last_msg_at    timestamptz;
  v_days_silent    int;
  v_new_tags       text[] := '{}';
  v_time_tag       text;
begin
  select c.customer_id, c.last_customer_message_at
  into v_customer_id, v_last_msg_at
  from public.chat_conversations c
  where c.id = p_conv_id;

  if not found then
    return;
  end if;

  if v_customer_id is not null then
    select total_orders, tier
    into v_total_orders, v_tier
    from public.customers
    where id = v_customer_id;

    -- ระดับลูกค้า (จาก customers.tier)
    if v_tier = 'vip' then
      v_new_tags := array_append(v_new_tags, 'VIP');
    elsif v_tier = 'gold' then
      v_new_tags := array_append(v_new_tags, 'Gold');
    elsif v_tier = 'silver' then
      v_new_tags := array_append(v_new_tags, 'Silver');
    end if;

    -- พฤติกรรมการซื้อ
    if v_total_orders = 1 then
      v_new_tags := array_append(v_new_tags, 'ลูกค้าซื้อครั้งแรก');
    end if;

    if v_total_orders >= 3
       and v_last_msg_at is not null
       and v_last_msg_at >= now() - interval '90 days' then
      v_new_tags := array_append(v_new_tags, 'ลูกค้าประจำ');
    end if;
  end if;

  -- ช่วงเวลาเงียบ (mutex) — นับจาก last_customer_message_at
  if v_last_msg_at is not null then
    v_days_silent := extract(day from (now() - v_last_msg_at))::int;

    v_time_tag := case
      when v_days_silent >= 365 then 'เกิน 1 ปี'
      when v_days_silent >= 180 then 'หลัง 180 วัน'
      when v_days_silent >= 90  then 'หลัง 90 วัน'
      when v_days_silent >= 60  then 'หลัง 60 วัน'
      when v_days_silent >= 45  then 'หลัง 45 วัน'
      when v_days_silent >= 30  then 'หลัง 30 วัน'
      when v_days_silent >= 15  then 'หลัง 15 วัน'
      when v_days_silent >= 7   then 'หลัง 7 วัน'
      when v_days_silent >= 5   then 'หลัง 5 วัน'
      when v_days_silent >= 3   then 'หลัง 3 วัน'
      else null
    end;

    if v_time_tag is not null then
      v_new_tags := array_append(v_new_tags, v_time_tag);
    end if;
  end if;

  update public.chat_conversations
  set auto_tags = v_new_tags
  where id = p_conv_id;
end;
$$;

revoke all on function public.recalc_chat_auto_tags(uuid) from public, anon;
grant execute on function public.recalc_chat_auto_tags(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 5) recalc_all_chat_auto_tags() — รัน recalc ทุก conversation (cron)
-- -------------------------------------------------------------------------
create or replace function public.recalc_all_chat_auto_tags()
returns int
language plpgsql
set search_path = public
as $$
declare
  v_count int := 0;
  v_conv  record;
begin
  for v_conv in
    select id from public.chat_conversations
    where status in ('open','assigned')
  loop
    perform public.recalc_chat_auto_tags(v_conv.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.recalc_all_chat_auto_tags() from public, anon;
grant execute on function public.recalc_all_chat_auto_tags() to authenticated;

-- -------------------------------------------------------------------------
-- 6) Trigger: recalc auto_tags เมื่อ orders เปลี่ยน (customer's tier may change)
-- -------------------------------------------------------------------------
create or replace function public.tg_recalc_chat_tags_on_order()
returns trigger language plpgsql set search_path = public as $$
declare
  v_conv_id uuid;
begin
  if NEW.customer_id is null then
    return NEW;
  end if;

  for v_conv_id in
    select id from public.chat_conversations
    where customer_id = NEW.customer_id
  loop
    perform public.recalc_chat_auto_tags(v_conv_id);
  end loop;

  return NEW;
end;
$$;

drop trigger if exists recalc_chat_tags_on_order_trigger on public.orders;
create trigger recalc_chat_tags_on_order_trigger
  after insert or update of status, payment_status on public.orders
  for each row execute function public.tg_recalc_chat_tags_on_order();

-- -------------------------------------------------------------------------
-- 7) RLS for chat_contact_notes
-- -------------------------------------------------------------------------
alter table public.chat_contact_notes enable row level security;

create policy chat_notes_staff_all on public.chat_contact_notes
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -------------------------------------------------------------------------
-- 8) Schedule daily recalc (requires pg_cron — uncomment when extension ready)
-- -------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- select cron.schedule(
--   'recalc-chat-auto-tags-daily',
--   '0 2 * * *',
--   $$select public.recalc_all_chat_auto_tags();$$
-- );

-- -------------------------------------------------------------------------
-- 9) Initial recalc + add chat_contact_notes to realtime
-- -------------------------------------------------------------------------
select public.recalc_all_chat_auto_tags();

alter publication supabase_realtime add table public.chat_contact_notes;
