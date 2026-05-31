-- 0015_chat_quick_reply_templates.sql
--
-- Omni-Chat composer upgrades (parity with LINE OA):
--   1. chat_quick_reply_templates — shared, org-wide canned replies any staff
--      can insert into the composer ("ข้อความตอบกลับที่ตั้งไว้"). Team-shared:
--      one library everyone sees + manages (is_staff RLS).
--   2. chat-attachments storage bucket — admin-uploaded images (device upload +
--      clipboard paste/crop) sent into chats as markdown ![image](url).
--      line-push v2 already splits markdown images into native LINE image
--      messages, and the web widget (CustomerChat) renders them inline, so no
--      edge-function change is needed. Bucket is public because LINE's image
--      message requires a publicly-fetchable originalContentUrl.

-- ── 1. Quick-reply templates (shared across the whole team) ──────────────
create table if not exists public.chat_quick_reply_templates (
  id          uuid primary key default uuid_generate_v4(),
  title       text not null,
  content     text not null,
  category    text,
  is_favorite boolean not null default false,
  sort_order  int not null default 0,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chat_qr_sort_idx
  on public.chat_quick_reply_templates (is_favorite desc, sort_order asc, created_at desc);

alter table public.chat_quick_reply_templates enable row level security;

drop policy if exists chat_qr_staff_all on public.chat_quick_reply_templates;
create policy chat_qr_staff_all
  on public.chat_quick_reply_templates
  for all to authenticated
  using (is_staff())
  with check (is_staff());

-- Seed common canned replies once (only when the table is still empty).
insert into public.chat_quick_reply_templates (title, content, category, is_favorite, sort_order)
select v.title, v.content, v.category, v.is_favorite, v.sort_order
from (values
  ('ทักทาย', 'สวัสดีค่ะ ยินดีให้บริการค่ะ 😊 สอบถามสินค้าตัวไหนแจ้งเอยได้เลยนะคะ', 'ทั่วไป', true, 1),
  ('ขอบคุณ', 'ขอบคุณมากค่ะ 🙏 ยินดีให้บริการค่ะ หากต้องการสอบถามเพิ่มเติม แจ้งได้ตลอดเลยนะคะ', 'ทั่วไป', true, 2),
  ('ขอข้อมูลสินค้า', 'รบกวนขอรุ่น/เบอร์ และขนาดของสินค้าที่ต้องการด้วยนะคะ เดี๋ยวเอยเช็กสต็อกและราคาให้ค่ะ 🙏', 'สอบถาม', false, 3),
  ('สินค้าสั่งผลิต', 'สินค้านี้เป็นสินค้าสั่งผลิตค่ะ ⏱️ ใช้เวลาประมาณ 3-5 วันทำการ หากมีการเปลี่ยนแปลงทางบริษัทฯ จะแจ้งให้ทราบค่ะ', 'สั่งผลิต', false, 4),
  ('ขอที่อยู่จัดส่ง', 'รบกวนขอชื่อ-ที่อยู่ และเบอร์โทรสำหรับจัดส่งด้วยนะคะ 📦', 'จัดส่ง', false, 5),
  ('แจ้งเลขพัสดุ', 'แจ้งเลขพัสดุนะคะ 📦 หมายเลข: [เลขพัสดุ] สามารถติดตามสถานะได้เลยค่ะ', 'จัดส่ง', false, 6)
) as v(title, content, category, is_favorite, sort_order)
where not exists (select 1 from public.chat_quick_reply_templates);

-- ── 2. chat-attachments storage bucket (public read, staff write) ────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

drop policy if exists "chat-attachments public read" on storage.objects;
create policy "chat-attachments public read"
  on storage.objects for select to public
  using (bucket_id = 'chat-attachments');

drop policy if exists "chat-attachments staff insert" on storage.objects;
create policy "chat-attachments staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and (is_staff() or is_owner()));

drop policy if exists "chat-attachments staff update" on storage.objects;
create policy "chat-attachments staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'chat-attachments' and (is_staff() or is_owner()))
  with check (bucket_id = 'chat-attachments' and (is_staff() or is_owner()));

drop policy if exists "chat-attachments staff delete" on storage.objects;
create policy "chat-attachments staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and (is_staff() or is_owner()));
