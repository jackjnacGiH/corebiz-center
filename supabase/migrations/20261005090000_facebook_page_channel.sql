-- Facebook Page Inbox uses the existing messenger conversation channel and
-- CoreBiz's product/knowledge tables. Public comments need their own event
-- ledger so Meta retries cannot publish the same reply twice.
create table if not exists public.facebook_comment_events (
  comment_id text primary key,
  page_id text not null,
  post_id text,
  reply_id text,
  status text not null default 'processing'
    check (status in ('processing', 'replied', 'skipped', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists facebook_comment_events_created_idx
  on public.facebook_comment_events (created_at desc);

alter table public.facebook_comment_events enable row level security;
create policy facebook_comment_events_staff_read on public.facebook_comment_events
  for select to authenticated using (public.is_staff());

insert into public.ai_personas (channel, display_name, prompt, bot_enabled)
values (
  'messenger',
  'เอย — Facebook Page',
  'ตอบลูกค้าทาง Facebook Messenger ในชื่อเอย โดยใช้ข้อมูลสินค้า ราคา สต็อก และความรู้ที่ตรวจสอบจาก CoreBiz เท่านั้น เมื่อมีหลายรายการให้เสนอเป็นลำดับเลขเพื่อให้ลูกค้าเลือก ห้ามเดาสินค้าหรือราคา',
  false
)
on conflict (channel) do nothing;
