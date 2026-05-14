---
sync: false
---
# CoreBiz Knowledge Vault (Obsidian)

นี่คือ **Obsidian Vault** สำหรับเก็บความรู้ของระบบ CoreBiz Center
ทุก `.md` ในนี้จะถูก sync เข้า Supabase `knowledge_chunks` (vector search) ด้วย script `scripts/sync-obsidian.ts`

## วิธีเปิด Vault ใน Obsidian

1. ติดตั้ง <https://obsidian.md>
2. กด `Open folder as vault` → เลือกโฟลเดอร์ `vault/` ของโปรเจคนี้
3. เริ่มเขียน note ได้เลย

## โครงสร้างโฟลเดอร์

```
vault/
├── 00-templates/      ← template สำหรับ note ใหม่ (ไม่ sync เข้า RAG)
├── 01-products/       ← ความรู้รายสินค้า (sync)
├── 02-categories/     ← คำอธิบายหมวดหมู่ (sync)
├── 03-policies/       ← นโยบาย เช่น คืนสินค้า รับประกัน (sync)
├── 04-faq/            ← คำถามที่พบบ่อย (sync)
├── 05-procedures/     ← ขั้นตอนปฏิบัติงาน SOP (sync)
└── 06-internal/       ← เอกสารภายในเท่านั้น (ไม่ sync — ตั้ง visibility: internal)
```

## Frontmatter (header ของทุก note)

ทุกไฟล์ต้องมี frontmatter รูปแบบนี้ที่บรรทัดบนสุด:

```yaml
---
type: product | faq | policy | procedure | category | knowledge
title: ชื่อสำหรับแสดงผล (ใช้แทน filename ตอนแสดงคำตอบ)
sku: ABR-001                  # เฉพาะ type: product
sync: true                     # ถ้า false → ข้ามไม่ sync
language: th | en | mixed     # default: th
visibility: public | internal  # default: public
tags: [abrasives, sandpaper]
---
```

## กฎสำคัญ

1. **อย่าใช้ space ในชื่อไฟล์** ใช้ `-` แทน เช่น `sandpaper-5inch.md`
2. **อย่าแก้ไฟล์ใน `00-templates/`** — ใช้เป็นต้นแบบเท่านั้น
3. **`06-internal/`** อย่าใส่เนื้อหาที่ลูกค้าไม่ควรเห็น (เพราะ visibility: internal จะไม่ขึ้นใน customer-facing chat)
4. **Heading hierarchy:** ใช้ `#` เป็น title หลัก, `##` เป็นหัวข้อย่อย — sync script จะแตก chunk ตาม heading

## วิธี sync เข้า Supabase

```bash
cd scripts
npm install        # ครั้งแรก
npm run sync       # sync ทุกไฟล์ที่เปลี่ยน
npm run sync:force # บังคับ re-embed ทุกไฟล์
```

## วิธีลบ note

1. ลบไฟล์ใน Obsidian
2. รัน `npm run sync:cleanup` เพื่อลบ chunks ที่ source_path ไม่มีไฟล์แล้ว
