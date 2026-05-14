# Phase 0 — Foundation Setup Guide

## เป้าหมาย

วาง foundation ของ CoreBiz Center ให้ครบ พร้อมเริ่ม Phase 1 (เชื่อม data layer):

- ✅ Supabase project + schema + RLS
- ✅ Obsidian Vault + sync script (Phaya embedding)
- ✅ Supabase Auth (Email/Password + Google + LINE)
- ✅ Frontend `lib/` (client + auth + protected routes + login page)
- ✅ i18n ครบทุกหน้า

---

## สิ่งที่พี่ต้องทำ (Manual Setup — ผมทำให้ไม่ได้)

### 🟢 1. สร้าง Supabase project

1. ไปที่ <https://supabase.com/dashboard/new>
2. ตั้งค่า:
   - Project name: `corebiz-center`
   - Region: **Southeast Asia (Singapore)**
   - Plan: Free (อัพเป็น Pro $25/mo เมื่อต้องการ daily backup)
3. รอประมาณ 2 นาที จะได้:
   - `Project URL` (เช่น `https://abcdefg.supabase.co`)
   - `anon` key (สำหรับ frontend)
   - `service_role` key (สำหรับ sync script — **เก็บเป็นความลับ**)

### 🟢 2. ตรวจสอบ Phaya embedding dimension

```powershell
cd api
# ตั้ง PHAYA_API_KEY ใน .env (หรือ export ใน shell)
$env:PHAYA_API_KEY = "sk-phaya-..."
node test_embed.js
```

จะเห็น `Vector Dimension: 1024` (หรือเลขอื่น)

ถ้าไม่ใช่ 1024 → แก้ `supabase/migrations/0001_initial_schema.sql`:
- ตำแหน่ง 1: `embedding vector(1024)` → `embedding vector(XXX)`
- ตำแหน่ง 2: `match_knowledge(query_embedding vector(1024), ...)` → `vector(XXX)`

### 🟢 3. Run SQL migration

ใน Supabase Dashboard → `SQL Editor` → `New query` →
copy เนื้อหา `supabase/migrations/0001_initial_schema.sql` → คลิก **Run**

จะได้:
- 13 ตาราง + RLS policies
- 5 functions: `is_staff()`, `is_owner()`, `match_knowledge()`, `recalculate_customer_totals()`, `handle_new_user()`
- Trigger auto-create profile ตอน signup
- Seed: คลังหลัก + 6 categories

### 🟢 4. เปิด Auth Providers ใน Supabase

**Dashboard → Authentication → Providers:**

#### Email
- เปิด `Email`
- Auto-confirm: ปิดไว้ก่อน (production) หรือเปิด (dev เร็ว)

#### Google
1. <https://console.cloud.google.com> → APIs & Services → Credentials → Create OAuth Client ID (Web)
2. Authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
3. Copy Client ID + Secret → ใส่ใน Supabase Google provider → enable

#### LINE Login
1. <https://developers.line.biz/console/> → สร้าง provider → สร้าง LINE Login channel
2. Callback URL: `https://www.corebiz.online/auth/line-callback` (และ `http://localhost:5173/auth/line-callback` สำหรับ dev)
3. ขอ scope: `profile openid email`
4. เก็บ **Channel ID** + **Channel Secret**

> LINE ไม่ใช่ provider ในตัว Supabase — ต้องใช้ Edge Function (deferred ถึง Phase 0.5)
> Login page **มีปุ่ม LINE แล้ว** แต่จะแสดง "Edge Function not deployed" จนกว่าจะ deploy

### 🟢 5. กรอก .env.local

**`frontend/.env.local`** (copy จาก `frontend/.env.example`):

```env
VITE_SUPABASE_URL=https://abcdefg.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxx
VITE_LINE_CHANNEL_ID=2001234567
VITE_LINE_CALLBACK_URL=http://localhost:5173/auth/line-callback
```

**`scripts/.env`** (copy จาก `scripts/.env.example`):

```env
SUPABASE_URL=https://abcdefg.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
PHAYA_API_KEY=sk-phaya-...
PHAYA_API_URL=https://api.phaya.io/api/v1/embedding/create
VAULT_PATH=../vault
```

### 🟢 6. ติดตั้ง dependency ใหม่

```bash
# ที่ root
cd frontend
npm install   # จะติดตั้ง @supabase/supabase-js

cd ../scripts
npm install   # ติดตั้ง gray-matter, dotenv, supabase-js, tsx
```

### 🟢 7. ลอง sync vault ครั้งแรก

```bash
cd scripts
npm run sync:dry   # ดูก่อนว่าจะ sync อะไรบ้าง
npm run sync       # ของจริง
```

ถ้าสำเร็จ จะเห็น:
```
✓ Inserted: X
✓ Updated:  Y
```

ตรวจใน Supabase Dashboard → Table Editor → `knowledge_chunks` ควรมี rows

### 🟢 8. Bootstrap user แรก

1. Run frontend:
```bash
cd frontend
npm run dev
```

2. เปิด <http://localhost:5173/login>
3. Login ผ่าน Google ครั้งแรก
4. กลับมาที่ Supabase Dashboard → `SQL Editor` →
```sql
update public.profiles
set role = 'owner'
where email = 'your-email@example.com';
```

5. Refresh frontend → คุณจะเป็น `owner` แล้ว → เข้าถึงทุกหน้าได้

---

## ✅ Checklist Phase 0

- [ ] Supabase project สร้างแล้ว
- [ ] Phaya dimension confirmed
- [ ] SQL migration run สำเร็จ (13 tables created)
- [ ] Email auth provider เปิด
- [ ] Google OAuth setup สำเร็จ
- [ ] LINE Login channel สร้าง (รอ Edge Function ใน Phase 0.5)
- [ ] `.env.local` กรอกครบ (frontend + scripts)
- [ ] `npm run sync` รันสำเร็จ
- [ ] Login ผ่าน Google ได้
- [ ] User แรกได้ role `owner` แล้ว
- [ ] เห็นหน้า Dashboard หลัง login

---

## ⏭️ ขั้นต่อไป — Phase 1

เมื่อ checklist ครบ ผมจะเริ่ม Phase 1:

1. เปลี่ยน `Inventory.tsx` ให้อ่าน/เขียน Supabase แทน local state
2. เปลี่ยน `Orders.tsx` ให้ดึงจาก `orders` + `order_items`
3. เปลี่ยน `CRM.tsx` ให้ดึงจาก `customers`
4. เปลี่ยน `Ecommerce.tsx` ให้ดึง products + inventory real-time
5. เพิ่ม **RAG chat widget** ที่ใช้ `match_knowledge()` function — ตอบจาก Obsidian content

---

## 📂 ไฟล์ที่สร้างใหม่ใน Phase 0

```
supabase/
├── migrations/0001_initial_schema.sql   (740 บรรทัด)
└── README.md

vault/                                    (Obsidian Vault ใหม่)
├── README.md
├── 00-templates/{Product,FAQ,Policy}.md
├── 03-policies/return-policy.md
├── 04-faq/general-faq.md
└── (01-products/, 02-categories/, 05-procedures/, 06-internal/ ว่าง รอเขียน)

scripts/                                  (Sync workspace)
├── package.json
├── tsconfig.json
├── sync-obsidian.ts
├── .env.example
└── README.md

frontend/
├── .env.example                          (NEW)
├── src/lib/                              (NEW)
│   ├── supabase.ts
│   ├── auth.ts
│   ├── AuthProvider.tsx
│   └── ProtectedRoute.tsx
├── src/pages/auth/                       (NEW)
│   ├── Login.tsx
│   ├── AuthCallback.tsx
│   └── LineCallback.tsx
├── src/App.tsx                           (UPDATED — wired Auth + ProtectedRoute)
├── src/i18n.ts                           (UPDATED — added auth/dashboard/inventory/orders/crm/chat/marketing namespaces)
└── package.json                          (UPDATED — added @supabase/supabase-js)

PHASE0_SETUP.md                           (ไฟล์นี้)
```
