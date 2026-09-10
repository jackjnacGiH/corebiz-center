# หลักฐานและขอบเขตการสำรวจ

## S1: สเปก API ที่ผู้ใช้ให้มา

- ต้นฉบับภายในเครื่อง: `D:\ระบบขนส่ง prompt Speed\open_api.yaml`
- OpenAPI `3.0.0`; `info.version` = `3.0.7`; `info.title` = `Open API V3`
- SHA-256: `9181d43d997cc2623d82e3f2f42a355d94575925db0c0f505a631052f8db2fa9`
- อ่านและ parse YAML สำเร็จ นับได้ 13 paths และ 15 operations
- เลขบรรทัดในคู่มืออ้างอิงต้นฉบับ hash นี้ ไม่ใช่ไฟล์ที่อยู่ใน GitHub
- ต้นฉบับมีข้อมูลตัวอย่างและค่าลับใน response ของ merchant จึงไม่คัดลอกไฟล์ทั้งฉบับเข้า repository และใช้เพียงชื่อฟิลด์กับข้อมูลสังเคราะห์ในคู่มือ
- ข้อมูลส่วนใหญ่เป็น description และ example ไม่ใช่ schema ที่ระบุ properties/required อย่างครบถ้วน การ parse ผ่านไม่ได้หมายความว่าใช้สร้าง SDK ได้ถูกต้องทันที

## S2-S5: PDF ภายในที่ตรวจครบทุกหน้า

ตรวจด้วยการ render เป็นภาพในพื้นที่ชั่วคราวและอ่านทั้งหน้า ร่วมกับ text extraction เมื่อมี text layer รวม 30 หน้า เก็บต้นฉบับไว้ที่เดิม ไม่มีการ upload หรือแทรกภาพเหล่านี้ในเอกสาร

| รหัส | ชื่อไฟล์ในโฟลเดอร์ขนส่ง | หน้า | บทบาทของเอกสาร |
| --- | --- | ---: | --- |
| S2 | `DOC_Shipsmile.pdf` | 5 | เอกสารประกอบสมัครบริการ/ยืนยันตัวตน ไม่ใช่คู่มือ API |
| S3 | `ราคาทุนขนส่ง API+Corporate_1 page 16Apr26.pdf` | 1 | ตารางราคาภายใน ระบุอัปเดต 04/2026 ไม่ใช้ยืนยันราคาปัจจุบัน |
| S4 | `ร่างสัญญาให้บริการระบบขนส่ง_เจ แนค.pdf` | 12 | ร่างสัญญาและเอกสารแนบท้าย ใช้ระบุหัวข้อที่ฝ่ายธุรกิจต้องยืนยัน |
| S5 | `สัญญา ขนส่ง.pdf` | 12 | ภาพสแกนสัญญาและเอกสารแนบท้าย ลำดับหน้าต่างจากร่าง |

SHA-256 สำหรับตรวจว่ากำลังอ้างอิงไฟล์ฉบับเดียวกัน:

| รหัส | SHA-256 |
| --- | --- |
| S2 | `9491852ab76063e8d203cf16e3656b5611b78c00a2efcf78158da7ab129dd594` |
| S3 | `95a1ec7c052246c6e9afd11496ff7bfac955c0a19a0db515f4c15d012f973af5` |
| S4 | `d18a5d7183f9fa557dc0003bbf3e2df5b061c8a57f3d3064682497c3cf080ab2` |
| S5 | `7f7a30d2d6fbe7c96051bc3bb834b3200ce08f0faa53d970c31e99fca5f6e47d` |

ผลอ่านที่เกี่ยวกับการวางระบบ โดยไม่เผยแพร่รายละเอียดการค้า:

- S4/S5 หน้า 3-4: ต้องยืนยันช่องทางเรียกเก็บเงินและกระบวนการ COD กับผู้รับผิดชอบบัญชีก่อนกำหนด workflow
- S4 หน้า 7-10 และ S5 หน้า 5-6, 9-10: ตารางราคาและข้อมูลอ้างอิงภายนอกไม่ใช่ schema ของ API และไม่รับรองว่าเป็นอัตราที่เปิดให้บัญชี J NAC ปัจจุบัน
- S4/S5 หน้า 11-12: มีหัวข้อการรับพัสดุ การเตรียมข้อมูล/บรรจุภัณฑ์ และการจัดการปัญหา จึงควรมีการตรวจข้อมูลและบันทึกเหตุการณ์ในระบบ
- S4 หน้า 6 / S5 หน้า 8: หน้าลงนามไม่เพียงพอให้ผู้จัดทำเอกสารรับรองสถานะสัญญาหรือการเปิดบัญชี ให้ผู้ดูแลสัญญายืนยันฉบับที่ใช้จริง
- ไม่ได้เปิดลิงก์ตารางราคาหรือพื้นที่บริการภายนอกที่อ้างถึงใน PDF จึงไม่สรุปว่าอัตราหรือพื้นที่นั้นยังใช้ปัจจุบัน

## S6: Repository ณ รอบสำรวจก่อนพัฒนา

ส่วนนี้เป็น snapshot ก่อนเริ่มพัฒนา เก็บไว้เพื่ออธิบายว่าระบบเดิมมีอะไรและขาดอะไร สถานะหลังพัฒนาอยู่ที่ S9

- [GitHub repository](https://github.com/jackjnacGiH/corebiz-center)
- ตรวจ branch `main` ผ่าน GitHub connector และตรวจ local HEAD: ตรงกันที่ `d5640bd9bba67ae21c5966e55bd5885f7d7633a8`
- มี untracked files เดิมใน workspace; ไม่แตะต้อง ไม่ stage ไม่ commit และไม่ push
- ตรวจคำสั่ง `.agents/AGENTS.md` และ `PROJECT_STANDARDS.md`; ไม่พบคำสั่งเพิ่มเติมใน `docs/shipping/`

| หลักฐานในโค้ด | สิ่งที่ยืนยันได้ |
| --- | --- |
| [vercel.json](../../vercel.json) และ [App.tsx](../../frontend/src/App.tsx) | CoreBiz อยู่ที่ `/center`; หน้าหลักใช้ lazy routes; ยังไม่มี shipping route |
| [Orders.tsx](../../frontend/src/pages/Orders.tsx) | ใช้งานคำสั่งซื้อและสถานะผ่าน `ordersApi` |
| [api.ts](../../frontend/src/lib/api.ts) บรรทัด 1331 เป็นต้นไป | `ordersApi.list/getById/updateStatus/create`; `getById` ไม่ได้เลือกข้อมูลติดต่อปลายทางจาก customer ให้ครบตาม API ขนส่ง |
| [database.types.ts](../../frontend/src/lib/database.types.ts) บรรทัด 311 เป็นต้นไป | orders มี `shipping_address`, `shipping_fee`, `carrier`, `tracking_no`, `payment_status` |
| [0001_initial_schema.sql](../../supabase/migrations/0001_initial_schema.sql) | โครงสร้าง orders/order_items/customers/warehouses และข้อจำกัดสถานะ |
| [0006_stock_decrement_trigger.sql](../../supabase/migrations/0006_stock_decrement_trigger.sql) | การเปลี่ยนสถานะ order กระทบ inventory; ห้าม map webhook ไป order ตรง ๆ |
| [0007_loyalty_points.sql](../../supabase/migrations/0007_loyalty_points.sql) | มีเงื่อนไขคะแนนเกี่ยวกับสถานะชำระเงินและคำสั่งซื้อ |
| [0043_rbac_phase2_roles_delete.sql](../../supabase/migrations/0043_rbac_phase2_roles_delete.sql) | helper สิทธิ์ read/write/delete ตาม role และ `is_active` |
| [ProtectedRoute.tsx](../../frontend/src/lib/ProtectedRoute.tsx) | gate หน้า back office; ยังไม่ใช่สิทธิ์เฉพาะงานจัดส่ง |
| [PROJECT_STANDARDS.md](../../PROJECT_STANDARDS.md) | pattern ของ data layer, cache, i18n และข้อควรตรวจ deployed source ก่อนพัฒนา |

ค้นใน source ของ `frontend/src`, `supabase/migrations`, `supabase/functions` และ `apps/storefront` ด้วย `promptspeed`, `shipsmile`, `shipment`, `tracking_no`, `carrier`: ไม่พบ integration Prompt Speed ใน source ที่ตรวจ พบช่องข้อมูลขนส่งใน schema/types เท่านั้น ข้อสรุปนี้ไม่ครอบคลุมโค้ด deployed ที่ไม่ได้ sync กลับ repository

## S7: เอกสารเทคนิคอ้างอิงสำหรับข้อเสนอ

- [Supabase: Environment Variables](https://supabase.com/docs/guides/functions/secrets): เก็บ credential ที่ backend และไม่ส่ง service-role/secret key ไป browser
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): ใช้ policy จำกัดการเข้าถึงข้อมูลในตารางที่ expose
- [Supabase changelog](https://supabase.com/changelog): ตรวจประกอบการวางแผน ณ วันสำรวจ ไม่ได้ใช้ติดตั้งหรือปรับ configuration ใด

## S8: แหล่งลิงก์ติดตามและตราขนส่งใน UI

ลิงก์ติดตามชี้หน้า public ของผู้ให้บริการและไม่พาลูกค้าเข้า CoreBiz: [Flash Express](https://www.flashexpress.co.th/fle/tracking), [BEST Express](https://www.best-inc.co.th/track), [KEX](https://th.kex-express.com/th/track-parcel), [J&T Express](https://www.jtexpress.co.th/service/track), [Thailand Post](https://track.thailandpost.co.th/), [DHL](https://www.dhl.com/th-th/home/tracking.html) และ [SPX Express](https://spx.co.th/th) บริการที่ไม่พบรูปแบบ URL เติมเลข Tracking ที่เสถียรจะเปิดหน้าค้นหาหลักให้ลูกค้ากรอกเลขเอง

ไฟล์ตราใน `frontend/public/shipping-carriers/` ใช้เพื่อระบุผู้ให้บริการในหน้าภายใน J NAC และมี text fallback เสมอเมื่อไฟล์โหลดไม่ได้ เครื่องหมายการค้าเป็นของเจ้าของแต่ละราย; อย่าใช้ไฟล์เหล่านี้เป็นหลักฐานว่าบัญชี J NAC เปิดบริการนั้นแล้ว

## S9: หลักฐานระบบที่ติดตั้ง

- โมดูลฐานถูก merge และ deploy ผ่าน GitHub/Vercel; production route คือ `/center/shipping` และผู้ไม่ login ถูกส่งไปหน้า login
- migration `20260908062224_shipping_module.sql` ถูกใช้กับ Supabase project ของ CoreBiz และ `shipping-api` ถูก deploy โดยคง JWT verification
- การตั้งค่าปลอดภัยอยู่ที่ UAT ปัจจุบันผูก Merchant UAT, ตั้ง billing mode เป็น prepaid, บันทึกเบอร์/อีเมลผู้ส่งที่ API ต้องใช้ และเปิด reads เฉพาะขอบเขตที่ทดสอบ ส่วน mutations ยังปิด จึงไม่เกิดคำขอสร้างพัสดุหรือธุรกรรมจากการเปิดหน้า/บันทึกร่าง
- ค่าใน response example ของ S1 ไม่ถือเป็น credential ของบัญชี J NAC และไม่ได้ถูกนำไปตั้งเป็น secret

## S10: เอกสารออนไลน์และสถานะ UAT ล่าสุด

- ตรวจ [PromptSpeed Open API](https://documenter.promptspeed.co.th/open-api/) และหน้ารายละเอียด `PUT /api/v3/pickup/{pickup_id}/cancel` วันที่ 10 กันยายน 2026; เวอร์ชันที่แสดงยังเป็น Open API V3 3.0.7
- เอกสารออนไลน์ยังมีข้อขัดแย้งเดิมระหว่าง method ใน path กับตาราง environment สำหรับ check-price, Wallet deposit, pickup create และ pickup cancel รวมทั้ง host ของ list shipment จึงยังต้องขอ contract ที่ผู้ให้บริการยืนยัน
- ตรวจบัญชี UAT แบบ read-only พบ Merchant เดิมผูก 11 carrier; Wallet Verified/Ready ยอด 0.00; Credit Waiting for document/Processing; COD account Active แต่ carrier mapping และ bank mapping เป็น 0
- ผล check-price ล่าสุดจากหน้า CoreBiz สำหรับกล่อง 20 × 10 × 30 ซม. น้ำหนัก 1,200 กรัม จาก 10280 ไป 10280 ส่งผล 11 บริการกลับมา โดยไม่ได้บันทึกร่างหรือสร้างพัสดุ ผลนี้ไม่ยืนยันวงเงิน การคิดเงินจริง หรือ Production
- Portal ยังแสดง legacy host บางส่วน ขณะที่ OpenAPI V3 และ check-price ที่ทดสอบใช้ `https://openapi-uat.promptspeed.co.th` สำเร็จ บันทึกเป็นความขัดแย้งของแหล่งข้อมูลโดยไม่เปลี่ยน endpoint อื่นตามการคาดเดา
- ไม่คัดลอกรหัส Merchant, credential, token, รหัสผ่าน หรือเอกสารการเงินลง repository

## สิ่งที่ไม่ได้ตรวจในรอบสำรวจเอกสาร

ข้อจำกัดเดิมของรอบสำรวจเอกสาร S1-S9 ยังคงเป็นหลักฐานตามวันที่ของแต่ละรอบ สำหรับ S10 ตรวจเฉพาะเอกสารออนไลน์และสถานะ UAT ที่ระบุ ไม่ได้สร้าง/ยกเลิกพัสดุ เรียกรถ เติมเครดิต แก้ carrier binding เปิด webhook หรือเปลี่ยนค่าระบบ และไม่ได้รับรองสถานะ Production, อัตราค่าบริการจริง, สัญญา หรือบัญชี COD
