# CoreBiz Center — Supabase Setup

## ขั้นตอนการ deploy

### 1. สร้าง Supabase project ใหม่ (หรือใช้ของเดิม)

แนะนำ **สร้าง project ใหม่** ชื่อ `corebiz-center` แยกจาก JNAC Admin Chat
- URL: <https://supabase.com/dashboard/new>
- Region: `Southeast Asia (Singapore)` — ใกล้ไทยที่สุด
- Pricing: Free 500MB → upgrade Pro ($25/mo) เมื่อต้องการ daily backup + > 500MB

### 2. ตรวจสอบ Phaya embedding dimension

ก่อน run migration ให้ทดสอบขนาด vector ก่อน:

```bash
cd api
cp .env.example .env   # ใส่ PHAYA_API_KEY
node test_embed.js
```

จะเห็นบรรทัด `Vector Dimension: 1024` (หรือเลขอื่น)

ถ้าไม่ใช่ `1024` ให้แก้ใน `0001_initial_schema.sql`:
- บรรทัด `embedding vector(1024)`
- function signature `match_knowledge(query_embedding vector(1024), ...)`

### 3. Run migration

มี 2 วิธี:

**A) ผ่าน Supabase Dashboard (ง่ายสุด):**
1. ไปที่ `SQL Editor` ใน dashboard
2. คลิก `New query`
3. Copy เนื้อหา `migrations/0001_initial_schema.sql` ทั้งหมด
4. Run

**B) ผ่าน Supabase CLI:**
```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

### 4. เปิด Auth Providers

ใน Dashboard → `Authentication` → `Providers`:

#### Email/Password
- เปิด `Email` provider
- ตั้ง `Site URL` = `https://www.corebiz.online`
- ตั้ง `Redirect URLs`:
  - `https://www.corebiz.online/auth/callback`
  - `http://localhost:5173/auth/callback` (สำหรับ dev)

#### Google
1. ใน Google Cloud Console → สร้าง OAuth 2.0 Client ID (Web application)
2. Authorized redirect URIs: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
3. Copy Client ID + Client Secret มาใส่ใน Supabase → Authentication → Providers → Google → enable

#### LINE Login
LINE **ไม่ใช่ provider ในตัวของ Supabase** ต้องใช้ Edge Function เป็น proxy
ขั้นตอน:

1. สร้าง LINE Login channel ที่ <https://developers.line.biz/console/>
   - Channel type: **LINE Login**
   - ขอ Scope: `profile openid email`
   - Callback URL: `https://www.corebiz.online/auth/line-callback`
2. เก็บ `Channel ID` และ `Channel Secret`
3. Deploy edge function (ดู `supabase/functions/line-auth/` ใน phase ถัดไป)

### 5. Bootstrap user แรก (owner)

หลัง deploy schema ให้ login ผ่าน Google ก่อน 1 ครั้ง แล้วเปิด SQL Editor:

```sql
update public.profiles
set role = 'owner'
where email = 'your-email@example.com';
```

## โครงสร้าง

### ตารางหลัก

| ตาราง | บทบาท |
|------|--------|
| `profiles` | ขยายจาก `auth.users` + role/language/provider |
| `categories` | หมวดหมู่สินค้า (parent-child) |
| `warehouses` | คลังสินค้า (มี default 1 คลัง) |
| `products` | สินค้าหลัก (TH/EN, image, spec, tags) |
| `product_variants` | ตัวแปร (สี/ขนาด/grit) |
| `inventory` | จำนวนคงเหลือต่อ (product × variant × warehouse) |
| `inventory_movements` | audit ทุกการเคลื่อนไหวสต๊อก |
| `customers` | ลูกค้า + tier auto-calc + loyalty_points |
| `orders` + `order_items` | คำสั่งซื้อ + workflow status |
| `quotes` + `quote_items` | ใบเสนอราคา (convert → order ได้) |
| `knowledge_chunks` | RAG vector store (จาก Obsidian Vault) |

### Functions

| Function | บทบาท |
|---------|--------|
| `is_staff()` | RLS helper — เช็คว่าเป็น admin/staff/owner |
| `is_owner()` | RLS helper — เช็คว่าเป็นเจ้าของระบบ |
| `match_knowledge()` | Vector similarity search สำหรับ RAG |
| `recalculate_customer_totals()` | คำนวณ tier + total_spent ใหม่ |
| `handle_new_user()` | Auto-create profile ตอน signup |

### Row Level Security

ทุกตารางเปิด RLS:
- **Staff** (owner/admin/staff) → CRUD ทุกอย่าง
- **anon** → อ่าน `products` ที่ active + `categories` ที่ active (สำหรับหน้า marketing/customer)
- **authenticated** ทั่วไป (เช่น customer login) → อ่านโปรไฟล์ตัวเอง

## Auto tier mapping

`recalculate_customer_totals()` จะตั้ง tier ตามยอดซื้อ (THB):

| ยอดซื้อสะสม | Tier |
|-----------|------|
| ≥ 500,000 | **VIP** |
| ≥ 200,000 | **Gold** |
| ≥ 50,000  | **Silver** |
| < 50,000  | **General** |

(ปรับเลขได้ใน SQL)
