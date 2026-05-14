# CoreBiz Scripts — Obsidian → Supabase Sync

## Setup (ครั้งแรก)

```bash
cd scripts
cp .env.example .env
# แก้ค่าใน .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PHAYA_API_KEY)
npm install
```

## คำสั่งใช้งาน

```bash
npm run sync          # sync เฉพาะไฟล์ที่เปลี่ยน
npm run sync:force    # บังคับ re-embed ทุกไฟล์ (เผื่อเปลี่ยน chunking strategy)
npm run sync:cleanup  # ลบ chunks ที่ไฟล์ใน vault ถูกลบไปแล้ว
npm run sync:dry      # ดูว่าจะเปลี่ยนอะไร โดยไม่เขียนจริง
```

## ทำงานยังไง

1. เดิน `vault/` หาทุก `.md` (ยกเว้น `00-templates/`, `06-internal/` ถ้า visibility=internal)
2. อ่าน frontmatter + content
3. แตก chunk ด้วยกฎ:
   - แยกตาม `## H2` ก่อน
   - ถ้า section ยังเกิน `CHUNK_MAX_TOKENS` (default 500) → แยกตาม paragraph + overlap 50 tokens
4. คำนวณ SHA-256 hash ของแต่ละ chunk → ถ้าตรงกับ DB เดิม → skip
5. ส่งข้อความที่เปลี่ยนไป Phaya batch ละ 8 → ได้ embedding vector
6. Upsert ลง Supabase `knowledge_chunks`

## Cost estimate

| ขนาด Vault | Tokens | Phaya cost (ครั้งแรก) |
|------------|--------|---------------------|
| 50 ไฟล์ × 1k tokens | ~50k | ขึ้นกับ tier Phaya |
| 200 ไฟล์ × 1k tokens | ~200k | ขึ้นกับ tier Phaya |

> **ประหยัด:** ใช้ incremental sync (default) → embed เฉพาะ chunk ที่เปลี่ยน

## Schedule sync (production)

แนะนำเรียกผ่าน:
- **Vercel Cron** (Pro): `*/30 * * * *` → call API endpoint ที่เรียก script นี้
- **GitHub Action** (ฟรี): commit ใน `vault/` → trigger sync
- **Manual:** เรียกหลังแก้ note สำคัญ

ตัวอย่าง GitHub Action จะอยู่ใน `.github/workflows/sync-vault.yml` (เพิ่มใน phase ถัดไป)
