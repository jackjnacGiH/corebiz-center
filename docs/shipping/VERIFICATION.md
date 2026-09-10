# ผลตรวจเอกสารระบบขนส่ง

วันที่สำรวจเอกสารเดิม: 8 กันยายน 2026

วันที่ตรวจสถานะล่าสุด: 10 กันยายน 2026

ผลลัพธ์: ส่วน “เกณฑ์ตรวจรับ” ด้านล่างเป็นหลักฐานรอบสำรวจเอกสารตาม Working Brief ก่อนเริ่มพัฒนา ส่วนสถานะโค้ดปัจจุบันบันทึกเพิ่มท้ายไฟล์ ความพร้อมของเอกสารหรือ build ไม่ใช่การรับรองว่า provider integration ใช้งานจริง

## เกณฑ์ตรวจรับและหลักฐาน

| เกณฑ์ | ผลตรวจ | หลักฐาน |
| --- | --- | --- |
| Markdown ภาษาไทยใน docs/shipping | ผ่าน | README, SOURCES, API_REFERENCE, FIELD_CATALOG, INTEGRATION_PLAN, QUESTIONS, VERIFICATION และ Working Brief |
| ครบทั้ง 15 operations | ผ่าน | parse S1 และเทียบหัวข้อ OP01-OP15 ในคู่มือและบัญชีฟิลด์; outbound 12 / inbound 3 |
| วิธีเรียก/request/response/ข้อจำกัด | ผ่านด้านเอกสาร | API_REFERENCE มีแต่ละ operation; FIELD_CATALOG ระบุชนิดจาก schema/example แยกกัน; ช่องว่างไม่ถูกเติมขึ้นเอง |
| อ่านเอกสารประกอบครบ | ผ่าน | PDF 4 ไฟล์ รวม 30 หน้า render และตรวจภาพครบ; S2 ยืนยันว่าเป็นเอกสารสมัคร ไม่ใช่ API |
| แผนเชื่อมสองแบบรวม COD/สิทธิ์ | ผ่าน | INTEGRATION_PLAN หัวข้อ 4-7 แยก order-linked/manual, COD, owner/admin, shipment status และ stock |
| ข้อมูลที่ต้องขอเพิ่ม | ผ่าน | QUESTIONS มีลำดับ P0/P1/P2 และผู้รับผิดชอบภายใน |
| อ้างอิงหลักฐาน | ผ่าน | SOURCES มี SHA-256, commit, ช่วงบรรทัด API และตำแหน่งโค้ด |
| รักษาขอบเขตงาน | ผ่าน | ไม่มีการแก้ application/schema/deployment หรือเรียก API ขนส่งจริง |

## การตรวจเชิงโครงสร้าง

- YAML ต้นฉบับ parse ผ่าน: 13 paths, 15 operations ไม่ใช่การตรวจว่า OpenAPI สมบูรณ์ตามมาตรฐานทุกจุด
- คู่มือและบัญชีฟิลด์มี OP01-OP15 อย่างละหนึ่งหัวข้อครบ ไม่มี operation หายหรือซ้ำ
- ตัวอย่าง JSON สังเคราะห์ 3 ชุด parse ผ่าน เป็นการตรวจ syntax ไม่ใช่ provider validation
- ตรวจ local Markdown links และ fenced blocks ครบทั้งชุด
- ตรวจ UTF-8/replacement character และ trailing whitespace ของไฟล์ใหม่โดยตรง เพราะไฟล์ untracked ไม่อยู่ใน git diff ปกติ
- ตรวจเทียบค่าตัวอย่างอ่อนไหวที่ดึงจาก YAML 36 ค่าที่ไม่ซ้ำ ไม่พบการคัดลอกในเอกสาร และตรวจไม่ให้มี signed URL credential/signature
- ทบทวนเนื้อหาว่าไม่คัดลอกตารางราคาทุน เลขบัญชี เลขบัตร ภาพเอกสารสมัคร ลายเซ็น หรือรายละเอียดสัญญามาเผยแพร่
- ตรวจ source hash ว่าตรงกับ SOURCES และ GitHub main ตรงกับ local HEAD ณ รอบสำรวจ
- `git diff --check` ผ่านสำหรับ tracked changes; เอกสารใหม่ตรวจ whitespace แยกตามข้างต้น

## ข้อค้นพบสำคัญที่ตรวจทานซ้ำ

| ประเด็น | บันทึกไว้ที่ |
| --- | --- |
| method ขัดกัน 4 operations | API_REFERENCE OP06/08/11/12 และ API-02 |
| host ของ list shipment ต่างจาก endpoint อื่น | OP03 และ API-01 |
| create shipment 200/201 และ print text/plain/JSON | OP02/04 และ API-03/LABEL-01 |
| response ว่างและ schema/example ไม่ครบ | FIELD_CATALOG และ SPEC-01 |
| callback authentication/idempotency ยังขาด | HOOK-01/02 และ INTEGRATION_PLAN หัวข้อ 8 |
| COD account/settlement ไม่มี endpoint ในชุดนี้ | COD-01/02 และ INTEGRATION_PLAN หัวข้อ 4.3 |
| billing mode | CoreBiz UAT ตั้งเป็น `prepaid`; Wallet ยัง 0.00 และ mutations ยังปิด |
| order status มีผลต่อ stock/loyalty | SOURCES S6 และ INTEGRATION_PLAN หัวข้อ 7 |

## ไม่ได้ทดสอบหรือดำเนินการ

- ไม่ใช้ credential และไม่เรียก API ขนส่งแม้เป็น read-only เพราะรอบนี้ใช้การตรวจเอกสาร
- ไม่สร้าง merchant/shipment/pickup ไม่ยกเลิก เติมเครดิต หรือแก้บัญชี COD
- ไม่รับ webhook จากบริการจริง; ไม่มีหลักฐาน end-to-end หรือ sandbox acceptance
- ไม่ตรวจ/เปลี่ยน Supabase production schema, RLS, secrets หรือ Edge Functions
- ไม่รัน application build/test เพราะเปลี่ยนเฉพาะเอกสารและไม่ได้พิสูจน์ runtime ด้วยการ build
- ไม่ stage, commit, push, deploy หรือส่งข้อความให้ผู้ให้บริการ

ก่อนเริ่มงานพัฒนาให้ใช้รายการ P0 ใน [QUESTIONS.md](QUESTIONS.md) และแผนทดสอบใน [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) เป็นจุดเริ่ม ไม่ใช้คำว่า "ผ่าน" ในรายงานนี้แทนการอนุญาตทดสอบธุรกรรม

## ผลตรวจเอกสารและสถานะ UAT รอบ 10 กันยายน 2026

| รายการ | ผล |
| --- | --- |
| Open API ออนไลน์ | ยังเป็น V3 3.0.7 และยังพบ method/base URL conflicts ที่บันทึกไว้ |
| HMAC / base URL UAT | GET และ POST JSON check-price ที่ทดสอบทำงานบน UAT; ยังไม่ครอบคลุม multipart/webhook |
| Merchant | มี Merchant UAT แล้ว; ไม่บันทึกรหัสหรือ credential ในเอกสาร |
| เช็กราคา | ทำงานจาก CoreBiz UAT |
| Wallet/Credit | Wallet Verified/Ready ยอด 0.00; Credit Waiting for document/Processing |
| Merchant carrier | Merchant UAT ผูกไว้ 11 บริการ และ check-price ล่าสุดตอบ 11 บริการ |
| Billing/origin | ตั้ง UAT เป็น prepaid และบันทึกเบอร์/อีเมลผู้ส่งสำหรับ API แล้ว โดยไม่เผยแพร่ค่าจริง |
| COD | บัญชี Active แต่ carrier mapping และ bank mapping เป็น 0 |
| Mutations | ปิดอยู่ ไม่มีการสร้าง/ยกเลิกพัสดุ pickup หรือเติมเครดิตในรอบนี้ |
| Webhook/pickup | ยังขาด contract ที่เพียงพอและคงปิด |
| คู่มือเปิดใช้ | เพิ่ม [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) แยกงาน CoreBiz, PromptSpeed และการยืนยันของ Boss jack |

การตรวจสถานะ UAT ไม่ใช่หลักฐานว่า Production พร้อมใช้ และการเห็นราคาไม่เท่ากับมีวงเงินหรือสิทธิ์สร้างพัสดุ

## ผลตรวจโค้ดรอบพัฒนา

วันที่: 8 กันยายน 2026

| รายการ | ผล |
| --- | --- |
| Unit/integration test ของ domain, adapter, API client, UI และ migration | ผ่าน 63/63 ในรอบ 10 กันยายน 2026 |
| CoreBiz production build | ผ่าน |
| ESLint | ผ่าน 0 error; มี warning เดิม 3 จุดนอกโมดูลขนส่ง |
| Deno type check ของ `shipping-api` และ `shipping-webhook` | ผ่าน |
| รหัสไปรษณีย์ 10330 | เติมกรุงเทพมหานคร/ปทุมวัน และแสดง 4 แขวงให้เลือก |
| รหัสไปรษณีย์ 10280 | เติมสมุทรปราการ/เมืองสมุทรปราการ และแสดง 6 ตำบลให้เลือก |
| ค้นผู้รับเดิม | แนะนำจากประวัติส่งในหน้าทดลองด้วยเบอร์โทรได้ |
| เลือกขนส่ง | แสดงการ์ดพร้อมโลโก้และ fallback text ได้ |
| ค้นสินค้าในคลัง | Production: พิมพ์เลขท้าย 5 ตัวของ SKU จริง พบตัวเลือกและเติมรหัสเต็มกับชื่อได้ โดยผลค้นหาไม่มีราคา/ต้นทุน |
| สินค้าในกล่อง | เพิ่มรายการด้วยมือได้ 1–5 แถว ปุ่มเพิ่มปิดเมื่อครบ 5 และไม่มีช่องราคาในฟอร์ม |

ฟอร์ม รหัสไปรษณีย์ และการค้น SKU ถูกตรวจบนหน้า Production ของ CoreBiz แล้ว ผลตรวจเพิ่มเติมวันที่ 10 กันยายนยืนยันว่า UAT reads/check-price ใช้งานได้และผลล่าสุดส่งราคา 11 บริการกลับมาโดยไม่บันทึกร่าง ส่วนการสร้างพัสดุ หักเครดิต รับ COD, pickup และ callback ของ PromptSpeed ยังไม่ได้ทดสอบ เพราะ mutations/webhook ยังปิดและบัญชีการเงินยังไม่พร้อม
