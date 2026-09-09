# ส่งต่อโมดูลขนส่ง CoreBiz

วันที่ 8 กันยายน 2026 · Branch `codex/shipping-module`

Boss jack อนุญาตให้พัฒนาโค้ดต่อจาก Working Brief แล้ว เอกสารนี้ระบุสถานะการพัฒนารอบแรก ส่วน Working Brief เดิมและเอกสาร API เก็บไว้เป็นหลักฐานการสำรวจ

## สิ่งที่พัฒนาแล้ว

- หน้า `/center/shipping` ภาษาไทย/อังกฤษ รองรับมือถือ มีเมนูและปุ่มจากรายละเอียดคำสั่งซื้อ
- ตัวอย่างและพิมพ์ลาเบล J NAC ขนาด 100 × 150 มม. หลังมี Tracking แสดงโลโก้บริษัท ชื่อ/ตราขนส่ง Barcode ผู้ส่ง ผู้รับ เบอร์โทร COD จำนวนสินค้า QR เพิ่มเพื่อน LINE `@jnac` และหมายเหตุหน้ากล่อง
- กำหนดจำนวนกล่องที่ส่งไปปลายทางเดียวกันได้ 1–99 กล่อง ระบบสร้างลาเบลหลายหน้าและใส่ลำดับให้อัตโนมัติ เช่น `1/3`, `2/3`, `3/3`
- สร้างร่างเองหรือดึงข้อมูลคำสั่งซื้อ ผู้รับ สินค้า และน้ำหนักมาให้ตรวจแก้ก่อนส่ง บันทึกที่อยู่เป็น snapshot
- ค้นผู้รับจากลูกค้าเดิมและประวัติส่งด้วยชื่อ เบอร์โทร หรือที่อยู่ แล้วเติมข้อมูลทั้งชุดได้ในคลิกเดียว
- รหัสไปรษณีย์ใช้ฐานเดียวกับหน้าลูกค้า: เติมจังหวัด/อำเภออัตโนมัติ และให้เลือกตำบลเมื่อรหัสเดียวครอบคลุมหลายตำบล
- เลือกบริการขนส่งผ่านการ์ดพร้อมโลโก้/ชื่อบริการบนมือถือและ desktop แทน native datalist
- หลังมี Tracking มีปุ่มคัดลอกลิงก์และเปิดหน้าติดตาม public ของผู้ให้บริการโดยไม่ต้อง login CoreBiz
- ฟอร์มผู้ส่ง ผู้รับ กล่อง สินค้า ยอด COD และบัญชี COD ที่อนุมัติแล้ว
- เจ้าของ/ผู้ดูแลจัดการสิทธิ์พนักงาน ที่อยู่ต้นทาง สภาพแวดล้อม และรหัสบัญชี COD ได้ พนักงานต้องมีสิทธิ์ชัดเจนและยังเปิดใช้งาน
- Backend ตรวจผู้ใช้จาก token และอ่านสิทธิ์ปัจจุบันทุกคำขอ ไม่เชื่อ role จาก client
- RLS ปิดการเขียนตารางใหม่โดยตรงจาก client การเขียนผ่าน backend พร้อมประวัติผู้กระทำ
- ป้องกันการบันทึกทับด้วย version และยึดรายการก่อนเรียกขนส่ง เพื่อให้การส่งพร้อมกันชนะได้ครั้งเดียว
- มี adapter ลงลายเซ็น HMAC เช็กราคา สร้างพัสดุ ขอใบปะหน้า และดึงสถานะ แต่ปิด network ไปผู้ให้บริการเป็นค่าเริ่มต้น
- timeout/ผลไม่ชัดเจนเข้าสถานะ `outcome_unknown` หรือคง `submitting` เพื่อห้ามส่งซ้ำอัตโนมัติ
- สถานะพัสดุแยกจากคำสั่งซื้อ ไม่มีการแก้ `orders.status`, `payment_status` หรือสต็อก และไม่ถือว่า delivered คือได้รับ COD

## ยังไม่พร้อมเปิดขนส่งจริง

โครงสร้างฐานข้อมูล, RLS, `shipping-api` และหน้า CoreBiz ถูกติดตั้งบน production แล้วสำหรับร่างและงานภายใน ส่วนการเรียกขนส่งจริงยังปิดแบบ fail-closed จึงยังไม่ใช่ระบบ production ครบวงจร

| ส่วนงาน                                 | สถานะ                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| ร่าง / สิทธิ์ / ตั้งค่าภายใน            | ติดตั้งบน CoreBiz production แล้ว; การตั้งค่าการเงินจำกัด owner/admin                    |
| ราคา / สร้างพัสดุ / ใบปะหน้า / ดึงสถานะ | มีโค้ด แต่ต้องผ่าน UAT ด้วยสเปกที่ยืนยันก่อนเปิด flag                                    |
| webhook                                 | ตอบ 503 เสมอ ยังไม่รับหรือบันทึก payload เพราะไม่มีสัญญายืนยันผู้ส่งที่ตรวจสอบได้        |
| ยกเลิกพัสดุ / นัดรับ / ยกเลิกนัดรับ     | ยังไม่มี workflow สำหรับผู้ใช้ ห้ามใช้การเก็บร่างเข้าคลังแทนยกเลิกพัสดุ                  |
| เติมเครดิต / ประวัติเครดิต              | ยังไม่ทำธุรกรรม ต้องยืนยัน prepaid/postpaid และวิธีตรวจสอบยอด                            |
| สมัคร/เปลี่ยนบัญชี COD กับผู้ให้บริการ  | ไม่มี API ในเอกสารที่ได้รับ หน้าตั้งค่าเก็บเฉพาะรหัสที่ได้รับอนุมัติแล้ว                 |
| รายงาน COD โอนแล้ว / กระทบยอด           | ยังไม่รองรับ รอข้อมูล settlement                                                         |
| แก้ผลคำขอไม่ชัดเจน                      | ห้ามสร้างใหม่ ต้องตรวจรายการด้วย external_id เดิมกับผู้ให้บริการก่อนพัฒนา reconciliation |

## ไฟล์หลัก

- [หน้าใช้งาน](../../frontend/src/pages/Shipping.tsx)
- [API client](../../frontend/src/lib/shipping-api.ts)
- [Backend](../../supabase/functions/shipping-api/index.ts)
- [Domain และ validation](../../supabase/functions/_shared/shipping-domain.ts)
- [Provider adapter](../../supabase/functions/_shared/promptspeed.ts)
- [ฐานข้อมูลและ RLS](../../supabase/migrations/20260908062224_shipping_module.sql)
- [Webhook ที่ยังปิดอยู่](../../supabase/functions/shipping-webhook/index.ts)

## สัญญา API ภายใน

เรียก `POST /functions/v1/shipping-api` ด้วย Supabase access token ปัจจุบันใน `Authorization: Bearer ...` และ JSON body `{ "action": "bootstrap" }` ห้ามส่ง service role key มาจาก browser

| action                  | ผู้มีสิทธิ์ | ข้อมูลหลัก                                             |
| ----------------------- | ----------- | ------------------------------------------------------ |
| bootstrap               | ผู้ใช้ขนส่ง | รับความพร้อมและบัญชี COD ที่เลือกได้                   |
| list                    | ผู้ใช้ขนส่ง | page เริ่ม 0, search เลขรายการ; หน้าละ 25              |
| get                     | ผู้ใช้ขนส่ง | id; รับรายการและประวัติ 50 รายการล่าสุด                |
| order_options           | ผู้ใช้ขนส่ง | search เลขคำสั่งซื้อ; สูงสุด 30                        |
| order_draft             | ผู้ใช้ขนส่ง | order_id; ดึงข้อมูลและเตือนถ้ามีรายการส่งเดิม          |
| recipient_options       | ผู้ใช้ขนส่ง | search อย่างน้อย 3 ตัวอักษร; ลูกค้า/ประวัติส่งสูงสุด 30 |
| product_options         | ผู้ใช้ขนส่ง | search รหัสสินค้าอย่างน้อย 2 ตัวอักษร; สินค้า active สูงสุด 20; ไม่คืนราคา/ต้นทุน |
| create_draft            | ผู้ใช้ขนส่ง | id UUID คงเดิมเมื่อ retry, draft, order_id หรือ null   |
| save_draft              | ผู้ใช้ขนส่ง | id, version, draft; แก้ได้เฉพาะ draft                  |
| archive                 | ผู้ใช้ขนส่ง | id, version; เก็บร่างที่ยังไม่ส่งเท่านั้น              |
| quote / print           | ผู้ใช้ขนส่ง | id; ต้องเปิด provider reads                            |
| submit / refresh_status | ผู้ใช้ขนส่ง | id, version; submit ต้องเปิด mutations ด้วย            |
| admin_data              | owner/admin | page; users/grants/accounts หน้าละ 50                  |
| save_settings           | owner/admin | settings environment/billing_mode/merchant_code/origin |
| save_cod                | owner/admin | account id/label/provider_account_id/active            |
| grant / revoke          | owner/admin | user_id ของ staff                                      |

ข้อมูล draft ยึด type `ShippingDraft` และ `parseDraft` เป็นสัญญา ตรวจเงินทศนิยมไม่เกินสองตำแหน่ง ไม่ปัดเงียบ ร่างยังไม่ครบเก็บได้ แต่ส่งไม่ได้ ข้อผิดพลาดส่งเป็น `{ "error": "code" }` ไม่ส่ง raw provider response หรือ credential กลับ client

ฟอร์มรายการส่งอิสระแสดงรหัส ชื่อ จำนวน และน้ำหนักสินค้า โดยเพิ่มเองได้สูงสุด 5 แถว การค้นรหัสอ่านเฉพาะสินค้า `active` และเติมชื่อทันทีเมื่อรหัสตรงกัน ช่องราคาไม่แสดงใน UI; ค่า `price` ใน draft เดิมยังคงไว้เพื่อเข้ากันได้กับสัญญา provider และมีค่าเริ่มต้น `0.00` สำหรับรายการที่สร้างเอง

## สถานะการติดตั้งและวิธีอัปเดต

1. migration `20260908062224_shipping_module.sql` ถูกใช้กับ Supabase CoreBiz แล้ว ห้ามแก้ไฟล์ย้อนหลังหรือ drop ตารางเพื่อ rollback frontend
2. การอัปเดต `shipping-api` ต้องคง JWT verification และตรวจ source ที่ deploy อยู่ก่อนทุกครั้ง
3. frontend ขึ้นผ่าน GitHub/Vercel workflow เดิม และต้องตรวจ route production กับไฟล์โลโก้ทุกเจ้า ไม่ใช้ผล build แทนผล deploy
4. คง environment=uat, billing_mode=unconfirmed, merchant ว่าง และ provider flags ปิด ระหว่างรอข้อมูลจริง
5. ตรวจ owner/admin, staff ก่อนและหลัง grant รวมถึงการสร้างร่างเอง/จากคำสั่งซื้อทุก release ที่แตะสิทธิ์

ตัวอย่างคำสั่ง deploy function หลังตรวจเป้าหมายแล้ว:

```powershell
npx.cmd supabase functions deploy shipping-api --project-ref owoedccmuqnzdtxvywgt
npm.cmd run build:corebiz
```

การ build ไม่ใช่ deployment ของ frontend ต้องใช้ release workflow เดิม ห้ามแทนที่ Edge Function อื่นหรือแก้ local `supabase/config.toml` ของผู้ใช้โดยไม่ตรวจเนื้อหา

## Secret และขั้นตอนเปิด UAT

ตั้งเฉพาะฝั่ง Supabase Secrets ไม่ตั้ง `VITE_` และไม่ใส่ค่าใน Git/แชต:

- `PROMPTSPEED_UAT_APP_ID`, `PROMPTSPEED_UAT_SECRET`
- `PROMPTSPEED_PRODUCTION_APP_ID`, `PROMPTSPEED_PRODUCTION_SECRET` ใช้เฉพาะหลังอนุมัติ production
- `PROMPTSPEED_SPEC_CONFIRMED`, `PROMPTSPEED_READS_ENABLED`, `PROMPTSPEED_MUTATIONS_ENABLED` ไม่มีค่าเท่ากับปิด

ก่อนตั้ง flag เป็น `true` ต้องยืนยัน HTTP methods, URL, HMAC test vector/encoding, หน่วยเงินและน้ำหนัก, รูปแบบ response และเวลา/timezone ตาม [คำถามผู้ให้บริการ](QUESTIONS.md) แล้วปรับ adapter/test ตามสัญญาที่ได้รับ การตั้ง flag ไม่ได้ทำให้ข้อขัดแย้งในสเปกหายไป

เปิด reads ใน UAT ก่อน ตรวจราคาและข้อมูลด้วย fixture ที่อนุมัติ จากนั้นขอ Boss jack ยืนยันก่อนทดสอบสร้างพัสดุที่อาจมีค่าใช้จ่าย จึงเปิด mutations และตรวจไม่คิดค่าบริการซ้ำเมื่อ timeout ห้ามเปิด production เพียงเพราะ build ผ่าน

ร่างผูกกับ environment/merchant ณ วันที่สร้าง หากเปลี่ยนบัญชี backend จะปฏิเสธ `account_changed` ให้เก็บร่างเก่าเข้าคลังและสร้างร่างในบัญชีที่ถูกต้อง ห้ามใช้ร่างเก่าข้ามบัญชี

## การตรวจสอบที่ทำได้ซ้ำ

ต้องมี Node 24 ขึ้นไป สำหรับ import TypeScript ใน unit test ฐานข้อมูลทดสอบใช้ PGlite แยกจากฐานข้อมูลจริง ไม่ต้องใช้ credential

```powershell
npm.cmd install --prefix "$env:TEMP/corebiz-shipping-test-runtime" --no-audit --no-fund @electric-sql/pglite@0.3.14
node --test tests/shipping-domain.test.mjs tests/shipping-database.test.mjs
npm.cmd run build:corebiz
npm.cmd run lint:corebiz
npx.cmd --yes deno check --node-modules-dir=none --no-lock supabase/functions/shipping-api/index.ts supabase/functions/shipping-webhook/index.ts
```

ถ้า runtime อยู่อื่น ตั้ง `SHIPPING_TEST_RUNTIME` เป็นโฟลเดอร์ที่ติดตั้ง PGlite ผลรอบล่าสุด: 13 tests ผ่าน, CoreBiz build ผ่าน, lint ไม่มี error มี warning เดิม 3 จุดนอก shipping และ Deno check ผ่าน ยังไม่ใช่หลักฐาน API/UAT จริง

ตรวจ browser ในหน้าทดลองแล้ว: ค้นผู้รับด้วยเบอร์โทร แสดงการ์ดบริการพร้อมไฟล์โลโก้ และทดสอบรหัส 10330 กับ 10280 สำเร็จ ทั้งสองรหัสเติมจังหวัด/อำเภอและแสดงตัวเลือกตำบลหลายค่า โดยรอบนี้ยังไม่เรียก provider จริง

## ข้อจำกัดและการปิดใช้งาน

- ผู้ได้รับสิทธิ์ขนส่งอ่านรายการส่งของบริษัทได้ทุกคน รอบนี้ไม่มีการแยกคลังหรือทีม
- ปุ่มกลับภายในหน้าและปิด browser เตือนร่างไม่บันทึก แต่ยังไม่ป้องกันการเปลี่ยน route จากเมนูอื่นทั้งหมด ให้บันทึกร่างก่อนออก
- โลโก้บริษัทบนใบปะหน้าใช้ `frontend/src/assets/shipping/jnac-logo.png` ซึ่งเป็นไฟล์ที่ Boss jack ให้สำหรับระบบขนส่งโดยเฉพาะ จัดวางแนวนอนและชื่อบริษัทใต้โลโก้ โดยไม่แก้ `org_settings.logo_url` หรือโลโก้ของส่วนอื่นใน CoreBiz/หน้าร้าน
- ใบปะหน้าขนาด 100 × 150 มม. แบ่งความสูงด้วย grid เพื่อกันพื้นที่อ้างอิงและสินค้าออกจากฟุตเตอร์ ชื่อบริษัทบนหัวใช้ขนาด 12px โลโก้ขนส่งไม่มีกรอบ และ Barcode สูง 24 มม. (เดิมกำหนดไว้ 12 มม.) โดยคงความสูงของแท่งไว้แม้เลขอ้างอิงยาว รายการสินค้าแสดงได้ 5 บรรทัดพร้อมจำนวนแต่ละรายการ
- ตรวจใน browser ด้วยข้อมูลจำลองที่มีสินค้า 5 รายการ ที่อยู่หลายบรรทัด หมายเหตุยาว และลาเบล 3 ใบ: ทุกส่วนอยู่ภายใน 100 × 150 มม. อ้างอิงกับสินค้าทั้ง 5 แถวอยู่เหนือฟุตเตอร์ และหมายเหตุแสดงครบ
- ขนส่งที่รู้จักใช้ mapping ของชื่อ สี และรูปตราที่ตั้งไว้ พร้อมกลับมาแสดงตราอักษรกับชื่อทันทีเมื่อรูปโหลดไม่ได้ บริการใหม่จึงไม่ทำให้หัวลาเบลว่าง
- ช่องหมายเหตุหน้ากล่องเป็นข้อมูลบนลาเบลเท่านั้น ไม่ส่งต่อไป Provider API และจำกัด 120 ตัวอักษร ค่าเริ่มต้นคือ `กรุณาอย่าโยน • ระวังของแตก`
- จำนวนกล่องสำหรับลาเบลเป็นข้อมูลภายใน CoreBiz เท่านั้น ไม่ส่งเป็นฟิลด์ใหม่ไป Provider API; QR LINE ใช้ไฟล์เดียวกับหน้า Storefront ซึ่งชี้ไป LINE `@jnac`
- รายการที่ส่งแล้วแก้ไขร่างไม่ได้ ไม่มีการแก้สถานะด้วยมือใน UI
- ปิด `PROMPTSPEED_MUTATIONS_ENABLED` เพื่อหยุดคำขอใหม่ โดยไม่ลบประวัติ ปิด reads ได้เพิ่มเมื่อจำเป็น
- ไม่ drop ตารางหรือย้อน migration ที่มีข้อมูลใช้งาน หากต้อง rollback frontend ให้เก็บฐานข้อมูลและ audit ไว้

## งานถัดไปที่ต้องทำก่อนเปิดเต็มระบบ

ทีมพัฒนารับสเปกยืนยันและ credentials ผ่านช่องทางปลอดภัย จากนั้นทำ UAT ราคา/สร้าง/ใบปะหน้า/สถานะ, การกู้ผล timeout, webhook ที่ยืนยันผู้ส่งและกัน replay ได้, workflow ยกเลิกและนัดรับ, เครดิตเฉพาะผู้ดูแล และกระทบยอด COD ก่อนรับรองระบบขนส่งครบวงจร
