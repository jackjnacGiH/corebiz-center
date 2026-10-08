# การปรับปรุง CoreBiz — 3 กลุ่ม

Boss jack อนุมัติให้ปรับปรุงตามรายงานวันที่ 8 ตุลาคม 2569 ทั้งหมด งานนี้เริ่มจาก main `23b14899` ใน worktree แยก เพื่อรักษางานเดิมที่ยังไม่ commit และใช้ deployed Edge source เป็นฐานเมื่อมีความต่าง

สถานะในเอกสารนี้หมายถึง **โค้ดและ migration ใน branch `codex/audit-three-groups` สำหรับตรวจสอบ** ยังไม่ได้ deploy หรือแก้ข้อมูล production งาน F01–F29 มี implementation แล้ว ส่วนการปิดความเสี่ยงของข้อมูลเก่า การตั้งค่าบริการ และการรับรองความเร็วจริงต้องทำตามรายการคงค้างด้านล่าง

## กลุ่ม 1 — P1: ช่องโหว่และความถูกต้องที่เร่งด่วน

| รายการ | สิ่งที่ปรับ | หลักฐานหลัก |
|---|---|---|
| F01/F02 | ตรวจตัวตนและ active role ก่อน knowledge/embedding/LINE; จำกัด batch/model และงบใช้งาน embedding | `staff-auth.mjs`, security handler/DB tests |
| F03 | ป้องกัน self-update identity/role/is_active; ban และ revoke session ด้วยกลไกที่ถูกต้อง | security migration + `admin-users` |
| F04 | LINE credentials เป็น write-only; API ส่งเฉพาะ metadata | metadata RPC + Settings + role tests |
| F05 | escape JSON-LD ป้องกัน closing script tag | `seo.ts` + storefront tests |
| F06 | embed ก่อน atomic replacement; เก็บ revision ย้อนคืนได้ | knowledge RPC + rollback tests |
| F07/F08/F09 | QT/Order/items/totals เป็น transaction; version guards; stock allocations บันทึกจำนวนที่ตัดจริง และคืนเท่าที่ตัด | atomic sales migration + PGlite |
| F10 | ให้แต้มครั้งเดียวต่อออเดอร์; คืนแต้มครั้งเดียวตามกติกาที่ Boss jack ยืนยัน | loyalty ledger tests |
| F11 | durable receive/prepare/send/complete; retry ใช้คำตอบเดิม; ผลส่งหรือ tool ไม่แน่นอนเข้าคิวตรวจสอบ; history กับ completion commit พร้อมกัน | delivery helper/DB tests + ContactPanel |
| F13 | ผล async และ action ผูกกับเอกสาร A/B ไม่สลับใบ | modal deferred tests |
| F27 | ใช้ main ล่าสุดพร้อม live Edge baseline และรักษา dirty changes เดิม | worktree + version snapshot |

กติกาแต้มที่ยืนยันแล้ว: ยกเลิกออเดอร์หรือคืนเงินเต็มจำนวนให้หักคืนแต้มที่เคยได้รับ หากแต้มถูกใช้ไปแล้วให้คงยอดติดลบและชดเชยจากแต้มที่ได้รับครั้งถัดไป การคืนสินค้าบางส่วนไม่ถือเป็นการคืนเงินเต็มจำนวน

## กลุ่ม 2 — P2: เสถียรภาพและ flow การทำงาน

| รายการ | สิ่งที่ปรับ | หลักฐานหลัก |
|---|---|---|
| F12 | รับ/ปฏิเสธ QT ใช้ lock และ transition เดียวกับ task | quote concurrency tests |
| F14 | รักษาส่วนลดต่อบรรทัดและท้ายบิล; คง lineage/version ตอนแก้ | modal + atomic sales tests |
| F15/F16/F17 | draft ตามห้อง, pending send ไม่ลบร่างใหม่, auth refresh เบื้องหลัง, memory/reset ตามห้อง | deferred chat/auth tests |
| F18 | ไฟล์ใหม่ private + signed URLs ต่ออายุ; เตรียม dry-run/copy/verify/rollback ไฟล์เก่า | private storage tests + migration script/runbook |
| F19 | manager ตรวจรายการขนส่ง outcome_unknown ด้วย reference เดิมโดยไม่ create อีกครั้ง | shipping handler tests |
| F20 | MOQ ตรวจทั้ง UI/server; SKU หายหรือ inactive ปฏิเสธก่อนเขียน QT | cart/handler/SQL tests |
| F21/F22 | profile cache แยก identity; upstream error แสดง retry ไม่แทนด้วย “ไม่มีสินค้า” | storefront tests |
| F23/F24 | cursor inbox โหลดได้ครบ; reorder error ทำ rollback และแจ้งผู้ใช้ | 643/1,303-room fixtures + note tests |
| F25 | Messenger sender ตรวจ staff/page/response window, บันทึกสถานะส่งจริง; Inbox/comment ledger ป้องกันซ้ำ | sender/target/delivery tests |
| F26 | update Next/related lockfile ตาม advisory พร้อมตรวจจริง; ยังต้องติดตาม upstream dev-only braces chain | npm audit before/after |
| F28 | npm ci + portable network-blocked tests/PGlite + Deno/lint/build gate; production CI เส้นทางเดียว | workflow/README/standards |
| F29 | รักษา `grit=120`/`เบอร์=120`; แยก assignment ของจำนวนออกจากสเปก | product continuation tests |

Facebook full channel ใช้ `FACEBOOK_PUBLIC_CHANNEL_ENABLED=true` เฉพาะหลังสิทธิ์ Meta และการทดสอบบัญชีที่อนุญาตพร้อม ค่าเริ่มต้นรักษาขอบเขต owner test ที่ใช้อยู่ คอมเมนต์ใช้คำตอบสาธารณะที่มีหลักฐานและ read-only RAG; Inbox ใช้ flow CoreBiz เมื่อเปิด full channel

## กลุ่ม 3 — P3: ความเร็วและการรองรับข้อมูลเพิ่ม

- enrichment รายชื่อแชตโหลดเฉพาะ company summary; โน้ตเต็มโหลดห้องที่เปิดและใช้ cache ห้องเดิม
- ค้นหน้าร้านด้วย filtered RPC แยกชนิด/รุ่น/ขนาด/เบอร์/ชนิดหลัง/SKU และ aliases ที่มีหลักฐาน เช่น Scotchbrite; สเปกยืนยันใช้ข้อมูลตัว SKU เท่านั้น ไม่เอาช่วงเบอร์หรือสเปกจากชื่อกลุ่มมาแทนตัวสินค้า full catalog/sitemap reads paginate ด้วย stable secondary key
- รายการ Order/QT ใช้ server search/status/count และ cursor; composite indexes มี fixture EXPLAIN ก่อน/หลัง
- ลบเฉพาะ quote-code index ที่ซ้ำ เมื่อ migration ยืนยัน definition และไม่มี dependency; คง unique constraint และหยุดหากสภาพจริงต่างจาก preflight
- mobile drawer โหลดเมื่อเปิดเมนู และ shipping warm-up import หลัง timer; มี loading/error/retry และยกเลิกเมื่อเปลี่ยน route/identity
- ตรวจ RLS policy 8 รายการและปรับ 7 รายการให้คำนวณ UID/role ครั้งเดียวต่อ statement โดยคงผลสิทธิ์เดิมทุกบทบาท คง `profiles_self_read` เดิมเพราะ regression test พบว่าการใส่ scalar SELECT ทำให้ profile UPDATE เกิด recursion `42P17`; migration หยุดหาก definition/helper ต่างจากที่ตรวจ
- ไม่สร้าง FK indexes ทั้ง 45 ตัวตาม warning ไม่ลบ unused indexes และไม่ทำ VACUUM FULL โดยไม่มี workload/dependency evidence
- เก็บเวลา retrieval/model/delivery แยกกันและใช้ request identity เดิมใน recovery การเพิ่ม ledger มี writes ที่จำเป็น จึงยังไม่อ้างว่าบอต production เร็วขึ้นจากขนาด payload fixture

หลักฐานที่ทำซ้ำได้อยู่ใน `output/audit-three-groups/` และ scripts วัดแต่ละส่วน ผลลด bytes/scan เป็นข้อมูลจำลอง ไม่ใช่การรับรองเปอร์เซ็นต์เวลาจริงของ production

ผลที่วัดแล้ว: chat enrichment 2,020,503 → 25,273 bytes (-98.75%); sales fixture 50,000 แถวสแกน → 100 แถว; RLS fixture เรียก UID 5,005 → 1 ครั้ง โดยเห็นข้อมูลที่อนุญาตจำนวนเท่าเดิม; ชุดคำค้น 12 เคสหาได้ 1/12 → 12/12 และ query ตัวอย่างคืน 1 จาก 2,511 แถว (688,272 → 319 bytes); initial static JS graph 778,192 → 770,773 bytes (-0.95%, gzip ประมาณ -0.46%) เป็น fixture/build comparison ด้วย input/lockfile เดียวกัน

สิ่งที่ตรวจใน production แล้วแต่ยังไม่ปรับ: autovacuum เปิดอยู่, pg_net TTL 6 ชั่วโมง, `net._http_response` ขนาดประมาณ 1.50 MB และ tuple estimates เป็น 0 จึงไม่มีหลักฐานเพียงพอให้สั่ง VACUUM FULL; main ยังไม่มี branch protection และ environment Production ไม่มี protection rules ดู acceptance และ SQL read-only ใน `audit-performance-acceptance.md`

leaked-password protection ยังปิดอยู่ และ `vector`/`pg_trgm` ยังอยู่ public การเปิด protection ต้องตรวจแผน Pro ขึ้นไปโดยไม่เพิ่มค่าใช้จ่ายเอง ส่วน extension ต้องตรวจ dependency ก่อนย้าย schema ทั้งสองเป็นรายการ hardening ที่ยังไม่ปิดบนระบบจริง ดู [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) และ [extension-in-public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)

## ลำดับปล่อยและสิ่งที่ต้องตรวจบนระบบจริง

1. ตรวจ preflight: duplicate inventory/order awards, function versions, historical orders/movements, bucket objects และ release commit ให้ตรงกับ snapshot
2. เตรียม build/Edge ของ release SHA ให้พร้อมก่อน ใช้ช่วงที่ทีมพักการเขียนเอกสารและคำขอเดิมจบแล้ว เพื่อไม่ให้ client รุ่นเก่าเขียนระหว่างเปลี่ยน RPC ใช้ migration security → atomic sales → delivery → storefront search → sales keyset index → RLS initplans ตามชื่อ timestamp ทดสอบ role/negative queries แล้ว deploy Edge callers และ frontend ของ commit เดียวกัน ให้ทีม reload ก่อนเปิด writes และทำ multi-session lock tests ใน staging ก่อนถึงขั้นนี้
3. Order เดิม 11 ใบต้องตรวจ baseline ก่อนการเปลี่ยน demand/ยกเลิกที่กระทบ stock; live read เพิ่มเติมพบ movement เชื่อมกับใบเหล่านี้ 7 รายการ (out 6/in 1) ส่วน 38 order-out เป็นจำนวนทั้งฐาน ไม่ใช่ทั้งหมดของ 11 ใบ RPC `sales_stock_review_queue` แสดงรายการให้ตรวจ ส่วน `baseline_order_stock` ต้องมีบันทึกและจำนวนที่ตรวจจริง ไม่เดา ไม่ปรับยอด on-hand ในการ baseline
4. ไฟล์ public เดิม 1,040 objects ต้องมี manifest/copy/hash/rollback ตาม `audit-private-attachments-rollout.md` ก่อนปิด public; ลิงก์ที่เคยส่งลูกค้าไปแล้วเปลี่ยนย้อนหลังไม่ได้ ต้องกำหนดวันหยุดใช้ลิงก์เดิม
5. คิว delivery ที่ uncertain ต้องให้เจ้าหน้าที่ตรวจและปิดรายการ การปิดรายการไม่ใช่การส่งข้อความหรือยืนยันว่าลูกค้าได้รับแล้ว เปิด provider redelivery เมื่อสิทธิ์และการทดสอบพร้อม
6. CI production job ต้องใช้ protected main/production environment; `vercel.json` ปิด Git auto-deploy เฉพาะ main เพื่อไม่ข้าม test gate ส่วน branch preview ยังใช้ Git integration
7. smoke-test read-only ของ login, chat A/B, profile/notes, public/member product/MOQ, QT/Order และ shipping recovery; การส่งจริงหรือธุรกรรมทดสอบให้ใช้บัญชีและรายการทดสอบที่อนุญาต พร้อมตรวจ content/telemetry หลังปล่อย

สามกลุ่มเป็นการจัดความสำคัญ ไม่ใช่ชุดที่ deploy แยกได้โดยไม่ตรวจ dependency เพราะ frontend, RPC และ Edge callers บางส่วนต้องใช้ร่วมกัน การเปลี่ยน policy/trigger/เอกสารมีผลต่อระบบจริง จึงต้องปล่อยตาม dependency ด้วย rollback plan ไม่ย้อน migration ที่ applied และไม่ checkout โค้ดเก่าทับงานเดิม

## ผลตรวจสุดท้ายของโค้ด

- `npm test`: **516/516 ผ่าน** รวม isolated PostgreSQL, fault injection, role equivalence, document/chat races, retry/debt และ structured search ไม่มี provider/ฐานข้อมูลจริงถูกเรียกจาก tests
- `npm run lint`: **0 errors / 3 warnings เดิม**; `npm run build`: CoreBiz และ storefront ผ่าน หน้าร้านสร้าง 730 static pages
- Deno 2.9.6 ตรวจ Edge ที่เปลี่ยนทั้ง **13 ตัวผ่าน** โดยคง type checks; YAML/JSON ของ CI parse ผ่านและ production job ต้องรอ verify job
- `git diff --check` ผ่าน; main ที่ fetch ล่าสุดยังเป็น `23b14899`; git status ของ workspace เดิมมีรายการค้างเท่าเดิม
- หน้าสินค้าจาก local production build ตรวจจริง: SKU 2020006681 ราคา 8.50 บาท, สั่งผลิต, ตะกร้าตั้งจำนวนและลดต่ำกว่า MOQ 100 ไม่ได้ และไม่แสดง `image_studio`/object ภายใน ไม่ submit ใบเสนอราคา
- npm audit snapshot: **runtime 0 vulnerabilities**; ยังมี **5 high entries ใน dev-only ESLint glob chain** ไม่มี safe same-major patch ที่เลือกใช้ ไม่ force downgrade ข้าม major ดู `output/audit-three-groups/dependency-audit-summary.json`

การทดสอบ auth/chat/ธุรกรรมบน staging ด้วยหลาย session และ provider จริงยังเป็น acceptance ก่อน production; ผลข้างต้นไม่ใช่หลักฐานว่า migrations หรือ Edge รุ่นใหม่นี้ deploy แล้ว
