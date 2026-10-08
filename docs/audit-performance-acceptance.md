# P3 — การตรวจหลังปล่อยระบบ

ผล payload, EXPLAIN และ bundle ในชุดนี้เป็น fixture/build measurements ไม่ใช่เวลาใช้งาน production การรับรองความเร็วต้องใช้ commit เดียวกัน อุปกรณ์และเครือข่ายเดิม รวมทั้งปริมาณข้อความค้างใกล้กัน

## การวัดหน้าแชต

1. ใช้บัญชีและห้องทดสอบใน staging ที่มีสิทธิ์ เปิด browser ใหม่และหน้า Omni-Chat เก็บ 20 ครั้งแบบ cold แล้วสลับห้องเดิม 20 ครั้งแบบ warm; แยกห้องมี New จำนวนมากและห้องทั่วไป เพราะการคลิกห้องอาจอัปเดตสถานะอ่าน จึงไม่ใช้แชตลูกค้าจริงเป็น fixture
2. วัดตั้งแต่คลิกห้องจนชื่อ/โปรไฟล์/สถานะ/โน้ตของห้องนั้นแสดงถูกต้อง บันทึก p50/p95, request count และ transferred bytes จาก Network panel พร้อมตรวจว่าห้องก่อนหน้าไม่ทับห้องใหม่
3. ปิด cache เฉพาะรอบ cold และเปิดตามปกติในรอบ warm เก็บผลก่อน/หลังด้วยขั้นตอนเดียวกัน ไม่เอาเวลา RAG มารวมกับเวลาเปิดห้อง

## ฐานข้อมูล

รัน `scripts/audit-performance-preflight.sql` แบบ read-only ก่อนและหลัง release โดยไม่ reset statistics ข้อมูลวันที่ 8 ต.ค. 2569: autovacuum เปิดอยู่, pg_net TTL 6 ชั่วโมง, `net._http_response` ขนาด 1,499,136 bytes; live/dead tuple estimates เท่ากับ 0 และ last-autovacuum/statistics-reset เป็น null จึงยังสรุปจาก warning อย่างเดียวไม่ได้ว่าต้องทำ VACUUM FULL

ใช้ EXPLAIN ของ query ที่หน้าแชต/เอกสารเรียกจริงใน staging พร้อม role และจำนวนแถวเดียวกัน ก่อนแก้ FK indexes หรือรวม permissive policies 40 รายการ คง semantics ของ role/USING/WITH CHECK และทดสอบ negative roles ทุกครั้ง งานนี้เลือก composite sales indexes จาก fixture และตรวจ dependency ก่อนลบ quote index ที่ซ้ำเท่านั้น

## บอตและการปล่อย

เปรียบเทียบ intent เดียวกัน แยก retrieval/model/tools/delivery โดยใช้ request identity เดิมใน telemetry ตรวจราคา/สต็อกสดและไม่สร้าง QT ซ้ำเป็นเกณฑ์ร่วมกับ p50/p95; replay เฉพาะบัญชีทดสอบที่อนุญาต ไม่ยิงข้อความลูกค้าจริงเพื่อ benchmark

GitHub ที่ตรวจจริงวันที่ 8 ต.ค.: main ยังไม่ protected, environment Production ยังไม่มี protection rules และมี CI secret names สำหรับ Vercel ครบ แต่ไม่อ่าน secret values ก่อนปล่อยต้องกำหนด required verification check/branch restriction และตรวจ workflow run ของ release SHA ที่ผ่านจริง พร้อม Preview/Production smoke test

## Hardening ที่ขึ้นกับบริการ

Advisor ยืนยันว่า leaked-password protection ยังปิดอยู่ ฟีเจอร์นี้ใช้ Supabase Pro ขึ้นไป ต้องตรวจแผนปัจจุบันก่อนเปิด โดยไม่อัปเกรดบริการหรือรับค่าใช้จ่ายเอง ดู [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

`vector` และ `pg_trgm` อยู่ใน public และ relocatable แต่การย้าย schema ต้องตรวจ type/operator/index/function/search_path ที่พึ่งพา แล้วทดสอบใน staging ก่อน; warning นี้ไม่ใช่หลักฐานว่าอ่านข้อมูลลูกค้าได้ งานนี้ยังไม่ย้าย extension ใน production ดู [extension-in-public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) และ [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations)
