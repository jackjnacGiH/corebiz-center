# รายการข้อมูลที่ต้องขอเพิ่ม

สถานะเริ่มต้น: รอคำตอบ เว้นแต่มีบันทึกคำตอบเพิ่มเติมด้านล่าง ไม่มีการส่งคำถามออกไปหาผู้ให้บริการในงานนี้

P0 = ต้องยืนยันก่อนพัฒนา integration ที่พึ่งพาข้อมูลนั้นหรือทดสอบบริการจริง; P1 = ต้องยืนยันก่อน pilot; P2 = ปรับปรุงภายหลังได้ ทุกข้ออ้าง S1/S4/S5/S6 จาก [SOURCES.md](SOURCES.md)

## คำถามถึงผู้ให้บริการ

| ID | ระดับ | คำถามและหลักฐานที่ต้องการ | เหตุผล/ที่มา |
| --- | --- | --- | --- |
| AUTH-01 | P0 | ขอ test vector HMAC สำหรับ GET, JSON POST, multipart และ Unicode/array พร้อม canonical string, expected signature, encoding, clock skew, expiry, Bearer onboarding และขอบเขต key | Overview S1:1-337 กับ OP01 security ไม่ครบกัน |
| API-01 | P0 | ยืนยัน production/UAT base URL ทุก operation; list shipment ใช้ promptspeed หรือ getshipment; ขอสเปกเวอร์ชันที่ใช้จริง | OP03 host ต่างกัน และ servers เป็น HTTP placeholder |
| API-02 | P0 | ยืนยัน POST check-price, POST wallet deposit, POST pickup, PUT pickup cancel หรือ method อื่น พร้อมตัวอย่างสำเร็จ | YAML กับ description ขัดกัน 4 operations |
| API-03 | P0 | ขอ response/error schema ครบ โดยเฉพาะ check-address, pickup create/cancel, webhook acknowledgment และ create shipment 200/201 | หลาย content ว่างและ success code ไม่ตรง |
| RETRY-01 | P0 | external_id ป้องกันคำขอซ้ำในขอบเขตใด ใช้ ID เดิม retry ได้หรือไม่; ถ้าไม่รู้ tracking หลัง timeout จะค้นด้วย external_id/reference ได้อย่างไร | OP02 ระบุ unique แต่ OP03 รับรอง search tracking เท่านั้น |
| HOOK-01 | P0 | วิธีลงทะเบียน 3 webhook URL, authentication/signature/header, secret rotation, replay window, test payload และวิธีตอบรับ | OP13-15 ไม่กำหนดวิธียืนยันผู้ส่ง |
| HOOK-02 | P0 | มี event ID / transaction ID หรือไม่; retry/backoff/timeout/order guarantee เป็นอย่างไร; replay/poll เมื่อพลาด event ทำอย่างไร | ต้องกัน status ย้อนและเงินซ้ำ |
| COD-01 | P0 | cod_account คือ ID แบบใด ขอวิธี list/create/approve/update account และ carrier ที่เปิด COD ของ merchant นี้ | OP02 มี cod_account แต่ไม่มี account API |
| COD-02 | P0 | มี API/webhook/report ยืนยันเก็บเงินและโอนเงิน COD หรือไม่ พร้อม settlement ID, tracking mapping, รอบสถานะและการแก้ยอด | delivered และข้อมูลค่าบริการไม่ใช่หลักฐาน settlement |
| MONEY-01 | P0 | เงินทุกช่องใช้หน่วยใด currency/scale/rounding ใด; อธิบาย cod_tax เทียบ cod_price_vat, price เทียบ total และ charge | request integer/response decimal string/float ปะปน |
| MONEY-02 | P0 | บัญชี J NAC ใช้วางบิล เติมเครดิต หรือแบบผสม; wallet endpoints ใช้กับบัญชีนี้หรือไม่; available balance/credit limit/approval status อ่านจากไหน | โหมดบัญชียังไม่ยืนยัน; OP08 รับคำขอไม่ได้ยืนยันอนุมัติ |
| MONEY-03 | P0 | shipment.price กับ shipment.company_price เกิดร่วมกันได้ไหม; price_surcharge เป็นยอดเพิ่ม/คืนหรือยอดแทนเดิม; deposit/withdraw อ้างบัญชีใด | OP14 ไม่พอทำ ledger โดยอัตโนมัติ |
| ADDRESS-01 | P0 | county/city mapping สำหรับที่อยู่ไทย, schema ผล check-address, จำเป็นต้องมีอีเมลผู้รับจริงหรือไม่, type ของ postcode | OP02/07 required และรูปแบบที่อยู่ไม่ครบ |
| CARRIER-01 | P0 | mapping EMS_SPEED/THAIPOST และ FLASH_EXPRESS_SPEED/FLASH_EXPRESS_SP พร้อมบริการที่บัญชีนี้เปิดใช้ | code ต่างกันระหว่าง request/callback |
| PARCEL-01 | P1 | ยืนยัน width/height/length, หน่วย products.weight, required/min/max ของกล่อง/products, สินค้าต้องห้าม/สินค้าอุตสาหกรรมที่ส่งได้ | OP02 สลับคำแปลมิติ และ minItems/หน่วยไม่ครบ |
| PRICE-01 | P1 | check-price รวม COD/ภาษี/ประกัน/พื้นที่/รับพัสดุหรือไม่ ต้องส่ง COD field อะไรเพิ่ม ราคาใช้ได้นานเท่าใด | OP06 example ไม่มี COD/insurance |
| CANCEL-01 | P1 | เงื่อนไขเวลา/สถานะยกเลิกพัสดุ, ค่าใช้จ่าย/คืนเครดิต, ยกเลิกซ้ำ และต้องยกเลิก pickup แยกหรือไม่ | OP05 มีเพียง success/error ตัวอย่าง |
| PICKUP-01 | P1 | ลงทะเบียน warehouse_no อย่างไร; รองรับ carrier/พื้นที่/จำนวนขั้นต่ำ/วันนัดใด; success คืน ID อะไรและเท่ากับ ticket_pickup_id ไหม; timeout ตรวจผลอย่างไร | OP11/12 response ว่างและ ID ไม่เชื่อมชัดเจน |
| LABEL-01 | P1 | ใบปะหน้า 4x3 ใช้หน่วยใด ขนาดอื่น/เครื่องพิมพ์ที่รองรับ, batch limit, mixed carrier, URL expiry, reprint และ Content-Type | OP04 JSON ถูกใส่ text/plain |
| LIST-01 | P1 | pagination/max limit, date format/timezone, sort direction, search exact/partial, closed filter, delivery scans/POD มี endpoint เพิ่มหรือไม่ | OP03 query declaration ไม่ครบและไม่มี tracking detail API |
| OPS-01 | P1 | rate limits/concurrency, timeout, HTTP error catalog, support escalation, UAT ที่ไม่คิดเงินจริง และขั้นตอนเปิด production | ไม่มีรายละเอียดใน S1 |
| DATA-01 | P1 | ข้อมูลที่จำเป็นต่อ provider, retention, การลบ/ส่งออก, log masking และสิทธิ์เก็บ label/driver data | ใช้ตั้งนโยบายภายในก่อน pilot |
| SPEC-01 | P2 | ขอ OpenAPI ที่แก้ required/properties, path parameter, content types, schema.examples และ legacy links | เพื่อให้สร้าง validator/SDK ได้อย่างน่าเชื่อถือ |

## ข้อมูลที่ทีม J NAC ต้องจัดเตรียม

| ผู้รับผิดชอบที่เสนอ | ข้อมูล/การตัดสินใจ | สถานะ |
| --- | --- | --- |
| Boss jack / ผู้ดูแลบัญชี | billing mode, merchant ที่จะใช้, ผู้ประสานงาน provider และเอกสารบัญชีฉบับที่มีผลจริง | รอยืนยัน; ไม่ส่ง credential ผ่านเอกสาร Git |
| คลัง/ทีมส่ง | จุดรับพัสดุ ชื่อผู้ติดต่อ เบอร์ อีเมล เวลาทำการ และ provider warehouse mapping | รอข้อมูล |
| owner/admin | รายชื่อพนักงานที่ได้สิทธิ์ส่ง สิทธิ์ยกเลิก/เรียกรถ/อ่านต้นทุน และผู้ตรวจเงิน COD | กติกาสร้าง/เติมเครดิตยืนยันแล้ว; รายชื่อกับสิทธิ์ย่อยยังรอ |
| ฝ่ายขาย/บัญชี | COD ทั้งยอดหรือยอดคงเหลือ วิธีจัดการชำระบางส่วน/หลายกล่อง/ส่งคืน และหลักฐานกระทบยอด | รอข้อมูล |
| ทีมส่ง | carrier เริ่มต้น ปริมาณต่อวัน จำนวนเครื่องพิมพ์/ขนาด label และส่งหลายกล่องหรือบางรายการหรือไม่ | รอข้อมูล |
| ผู้ดูแลข้อมูล | retention ของผู้รับ label/slip/driver contact และผู้เข้าถึง | รอนโยบาย |

## ข้อความสำหรับประสานผู้ให้บริการ

ข้อความนี้เป็นร่างภายใน **ยังไม่ได้ส่ง**:

> J NAC กำลังเตรียมเชื่อมระบบขนส่งผ่าน CoreBiz Center สำหรับพนักงานภายใน รองรับสร้างรายการจากคำสั่งซื้อและรายการอิสระ รวม COD ขอข้อมูลยืนยันตามรายการ P0 ข้างต้น โดยเฉพาะ base URL/method, ตัวอย่าง HMAC, วิธีตรวจ webhook และกู้รายการเมื่อ timeout, การตั้งค่าบัญชี COD/กระทบยอด และโหมดบัญชีวางบิลหรือ Wallet กรุณาส่งข้อมูลลับผ่านช่องทางที่ผู้ดูแลบัญชีกำหนด ไม่รวมในเอกสาร repository

เมื่อได้รับคำตอบ ให้บันทึกวันที่ แหล่งที่มา และเวอร์ชันที่ใช้ พร้อมแก้ข้อเสนอที่เกี่ยวข้องก่อนพัฒนา ไม่ถือว่าไม่มีคำตอบเท่ากับอนุมัติค่า default
