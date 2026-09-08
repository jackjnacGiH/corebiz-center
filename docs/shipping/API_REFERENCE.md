# คู่มือ API ขนส่ง V3 สำหรับเตรียมเชื่อม CoreBiz

อ้างอิง S1 ใน [SOURCES.md](SOURCES.md) เท่านั้นสำหรับข้อเท็จจริง API; ยังไม่ทดสอบกับบริการจริง

## ข้อตกลงในการอ่าน

`required` ในคู่มือนี้หมายถึงคำอธิบายต้นฉบับระบุว่าบังคับ ไม่ได้หมายความว่า OpenAPI schema มี required array แล้ว หากมีเพียง example ให้ถือเป็น **ฟิลด์ที่พบในตัวอย่าง** ไม่อนุมานว่าเป็นฟิลด์บังคับหรือ enum ที่ครบถ้วน ดูชนิดข้อมูลทุกฟิลด์ที่พบใน [FIELD_CATALOG.md](FIELD_CATALOG.md)

ตัวอย่างใช้ค่าที่สร้างใหม่และ placeholder ไม่ใช่ payload พร้อมส่งจริง ต้องแทนค่าจากข้อมูลที่ตรวจสอบแล้วและลงลายเซ็นที่ backend ก่อนใช้

## Environment และ authentication

S1 บรรทัด 1-337:

| ส่วน | ตามต้นฉบับ | แนวทางในแผน |
| --- | --- | --- |
| Production ส่วนใหญ่ | `https://openapi.promptspeed.co.th` | ต้องให้ผู้ให้บริการยืนยัน base URL |
| UAT ส่วนใหญ่ | `https://openapi-uat.promptspeed.co.th` | แยก credential และข้อมูลจาก production |
| List shipment | production ใน description เป็น `https://api.getshipment.co` | ยังไม่เลือก host แทนผู้ให้บริการ |
| OpenAPI servers | `http://{{v3_api_url}}` | เป็น placeholder ห้ามใช้สร้าง SDK แล้วส่ง HTTP จริง |
| Create merchant | มี `security: bearerAuth` | ยังไม่มี endpoint ขอ Bearer token ในไฟล์นี้ |
| การเรียกของ merchant | Overview อธิบาย HMAC-SHA256 ผ่าน query | ต้องยืนยันขอบเขตการใช้ เพราะ operations อื่นไม่ได้ประกาศ security ครบ |
| Webhook | host ตัวอย่างของ partner | ผู้ให้บริการเรียกเข้า backend ของ CoreBiz; ไม่ใช่ path บน host ขนส่ง |

### ขั้นตอน HMAC ตาม Overview

1. รับ `V3_MERCHANT_APP_ID` และ `V3_MERCHANT_SECRET` จากที่เก็บลับฝั่ง server
2. สร้าง `timestamp` เป็น Unix epoch **milliseconds**
3. สร้าง `key = Base64(timestamp + "-" + app_id)`
4. รวม query ของ request ที่ใช้งานจริงกับ `key` และ `timestamp`; query ชื่อซ้ำถูกเก็บเป็น array ตามลำดับที่พบ
5. เริ่ม base string ด้วย `secret=<secret>` แล้วต่อ `ชื่อ=ค่า` ตามชื่อ query ที่เรียง A-Z **ไม่มี `&` คั่น**; array ต่อชื่อซ้ำหนึ่งครั้งต่อค่า
6. ใช้ HMAC-SHA256 ของ base string โดยใช้ secret เป็น key; ตัวอย่าง Python/Go ในสเปกส่งออก hex
7. ส่ง query เดิมพร้อม `key`, `timestamp`, `signature`; ไม่ใส่ `signature` เข้า base string

แผนภาพข้อความสังเคราะห์สำหรับ request ที่มี `limit` และ `viewpoint`:

```text
secret=<SECRET>key=<BASE64_KEY>limit=10timestamp=<EPOCH_MS>viewpoint=all
```

**ต้องยืนยัน AUTH-01:** วิธี canonicalize ค่าว่าง/array/Unicode, percent encoding ก่อนหรือหลัง sign, อายุ timestamp และ clock skew, ว่า JSON/multipart body ต้องรวมในการ sign หรือไม่ ตัวอย่าง Overview อ่านเฉพาะ query และไม่ได้ sign method/path/body จึงไม่ควรเติมกฎเอง ตัวอย่าง JavaScript ใช้ `CryptoJS.digest` แต่ภาษาอื่นใช้ hex ต้องขอ test vector จากผู้ให้บริการ ไม่เปลี่ยนเป็น Base64 เอง

**ข้อเสนอ:** ใช้ HTTPS, allowlist host, ไม่ log URL ที่มี auth query/base string, ไม่เอา secret ไปไว้ใน `VITE_*`; signing ของ merchant ไม่ใช่หลักฐานว่าวิธีตรวจ webhook เหมือนกัน

## รายการ operations

| ID | ทิศทาง | Method / Path | งาน | บรรทัด S1 |
| --- | --- | --- | --- | --- |
| OP01 | ส่งออก | POST `/api/v3/merchant` | สร้าง merchant | 338-662 |
| OP02 | ส่งออก | POST `/api/v3/shipment` | สร้างรายการส่ง | 663-1069 |
| OP03 | ส่งออก | GET `/api/v3/shipment` | รายการ/ค้นหาพัสดุ | 1070-1501 |
| OP04 | ส่งออก | POST `/api/v3/shipment/print` | ใบปะหน้า | 1502-1735 |
| OP05 | ส่งออก | PUT `/api/v3/shipment/cancel/{TRACKING_NUMBER}` | ยกเลิกพัสดุ | 1736-1906 |
| OP06 | ส่งออก | POST `/api/v3/shipment/check-price` | เช็กราคา | 1907-2130 |
| OP07 | ส่งออก | GET `/api/v3/shipment/check-address` | ตรวจที่อยู่ | 2131-2176 |
| OP08 | ส่งออก | POST `/api/v3/wallet` | ขอเติมเครดิต | 2177-2373 |
| OP09 | ส่งออก | GET `/api/v3/wallet` | ประวัติเงินเข้าออก | 2374-2516 |
| OP10 | ส่งออก | GET `/api/v3/carrier/list` | รายชื่อบริการขนส่ง | 2517-2697 |
| OP11 | ส่งออก | POST `/api/v3/pickup` | เรียกรถเข้ารับ | 2698-2778 |
| OP12 | ส่งออก | PUT `/api/v3/pickup/{pickup_id}/cancel` | ยกเลิกรถเข้ารับ | 2779-2823 |
| OP13 | รับเข้า | POST `/path-status` | สถานะพัสดุ | 2824-2926 |
| OP14 | รับเข้า | POST `/path-price` | ราคา/รายการปรับราคา | 2927-3180 |
| OP15 | รับเข้า | POST `/path-pickup` | สถานะรถเข้ารับ | 3181-ท้ายไฟล์ |

ตารางใช้ method ในโครงสร้าง YAML ส่วน OP05 ใช้ path parameter ตาม description; key ใน YAML ใส่เลขพัสดุตัวอย่างจริงไว้ ต้อง normalize ก่อนทำ SDK

## OP01: สร้าง merchant

`POST /api/v3/merchant` | Bearer authentication ตาม operation | JSON

**ข้อมูลรับเข้า:** string ที่ระบุ required ได้แก่ `full_name`, `company_name`, `sms_name`, `email`, `address`, `county`, `city`, `state`, `postcode`, `mobile1`, `reference`; `mobile2` เป็นตัวเลือก ไม่มีคำอธิบายความหมาย/uniqueness ของ `reference` ที่เพียงพอ

**ตอบกลับ:** HTTP 201, JSON `data` มี `code`, `api_key`, `api_secret`, ข้อมูลร้านและ `carriers[]`; มี `timestamp`, `request_id` ข้อมูล credential ต้องเก็บฝั่ง server ห้ามส่งทั้ง response ไป UI หรือ log

**ผิดพลาด:** HTTP 400 `ERROR_VALIDATION` พร้อม `message`, `timestamp`, `request_id` ตัวอย่างคือขาดชื่อร้าน

**ข้อจำกัด/การใช้กับ CoreBiz:** งานตั้งต้นของเจ้าของ/ผู้ดูแล ไม่ใช่สิ่งที่ต้องทำทุก shipment และไม่สร้าง merchant ต่อพนักงาน ต้องถามว่าบัญชี J NAC มี merchant อยู่แล้วหรือผู้ให้บริการสร้างให้ ไม่พบ API อ่าน/แก้ merchant หรือออก Bearer token ในสเปกนี้

## OP02: สร้างรายการส่ง

`POST /api/v3/shipment` | JSON | HMAC ตาม Overview รอยืนยันขอบเขต

| ฟิลด์ | ตาม description | ความหมาย/ข้อสังเกต |
| --- | --- | --- |
| `carrier_code` | required string | code ของบริการขนส่ง |
| `reference_no` | required string | เลขอ้างอิง เช่น Order ID; รายการอิสระใช้เลขภายใน CoreBiz |
| `external_id` | required string | unique random ID/UUID; สเปกระบุให้เปลี่ยนสำหรับ new request แต่ไม่อธิบาย retry |
| `box_width`, `box_height`, `box_length` | float; default 1 | cm; description ของ height/length สลับความหมาย ต้องยืนยัน |
| `box_weight` | integer | น้ำหนักกล่อง g; แม้ตารางไม่ทำเครื่องหมาย required แผนเสนอให้พนักงานกรอกน้ำหนักจริง |
| `cod_account` | string | example เป็น number; ต้องยืนยันว่าเป็น ID ของบัญชีที่ลงทะเบียน ไม่ใช่เลขบัญชีธนาคาร |
| `cod_amount` | integer | ยังไม่ระบุหน่วยสกุลเงิน/ทศนิยมอย่างชัดเจน |
| `origin`, `destination` | object | สมาชิกที่อยู่ตามตารางถัดไป; required ของตัว container ไม่ชัดเจน |
| `products` | array ใน example | สมาชิกตามตารางถัดไป; minItems/required ของ container ไม่ระบุ |
| `is_warranty` | optional boolean | การขอประกัน ต้องเลือกโดยพนักงานตามนโยบายที่ยืนยัน |
| `product_price` | optional float | required เมื่อ `is_warranty=true` |

ที่อยู่ทั้งสองฝั่งใช้ `fullname`, `address`, `county`, `city`, `state`, `postcode`, `email`, `telephone1` เป็น required string; `telephone2` เป็นตัวเลือก สเปกตัวอย่างแสดง county เป็นตำบล/แขวงและ city เป็นอำเภอ/เขต แต่คำแปลในตารางไม่ชัด ต้องยืนยัน mapping กับ OP07; อย่าสร้างอีเมลลูกค้าขึ้นเองเพียงเพื่อผ่าน validation

`products[]` มี required `qty` integer, `name` string สูงสุด 100, `price` integer ตามตารางแต่ example เป็น decimal string, `weight` integer โดยไม่บอกหน่วยในแถวนี้; ตัวเลือก `code`, `size`, `color`, `detail` string สูงสุด 200, `category` string สูงสุด 200, `width`, `height`, `length` integer หน่วย cm

**ตัวอย่างสังเคราะห์ของ body เพื่ออธิบายรูปทรงข้อมูล:**

```json
{
  "carrier_code": "<ENABLED_CARRIER_CODE>",
  "reference_no": "SO-DEMO-0001",
  "external_id": "00000000-0000-4000-8000-000000000001",
  "box_width": 20,
  "box_height": 10,
  "box_length": 30,
  "box_weight": 1200,
  "cod_account": "<APPROVED_COD_ACCOUNT_ID>",
  "cod_amount": 500,
  "origin": {
    "fullname": "ผู้ส่งตัวอย่าง",
    "address": "<ORIGIN_ADDRESS>",
    "county": "<ORIGIN_SUBDISTRICT>",
    "city": "<ORIGIN_DISTRICT>",
    "state": "<ORIGIN_PROVINCE>",
    "postcode": "<ORIGIN_POSTCODE>",
    "email": "sender@example.invalid",
    "telephone1": "<ORIGIN_PHONE>"
  },
  "destination": {
    "fullname": "ผู้รับตัวอย่าง",
    "address": "<DESTINATION_ADDRESS>",
    "county": "<DESTINATION_SUBDISTRICT>",
    "city": "<DESTINATION_DISTRICT>",
    "state": "<DESTINATION_PROVINCE>",
    "postcode": "<DESTINATION_POSTCODE>",
    "email": "recipient@example.invalid",
    "telephone1": "<DESTINATION_PHONE>"
  },
  "products": [{"qty": 1, "code": "DEMO-ITEM", "name": "สินค้าตัวอย่าง", "price": 500, "weight": 1000}],
  "is_warranty": false,
  "product_price": 0
}
```

ตัวอย่างไม่ยืนยันหน่วยเงิน, type ของ `cod_account`, หน่วย `products[].weight` หรือความครบถ้วนที่ผู้ให้บริการจะรับจริง ค่า external_id เป็นตัวอย่างเท่านั้น ห้ามนำไป reuse และห้ามใช้คำขอใหม่แก้ timeout โดยไม่ตรวจผลเดิม

**ตอบกลับ:** response map มี HTTP **200** แต่ description ระบุ **201**; example JSON มี `data.tracking_number`, `data.charge`, `data.wallet_balance` เป็น string และ `timestamp` ไม่พบ `request_id` ใน success example อย่าบังคับว่าทุก response ต้องมี

**ผิดพลาด:** 400 `ERROR_VALIDATION` เช่น `origin.telephone1` สั้นกว่า 9 ตัวอักษรใน example; 500 `ERROR_INTERNAL_SERVER_ERROR` มีข้อความเกี่ยวกับ api key ทั้งที่เป็น HTTP 500 ไม่ควร retry ทุก 500 อัตโนมัติ

**ข้อจำกัด:** ไม่เห็นจำนวนกล่องหลายใบต่อ request, cancellation window, idempotency contract หรือการค้นด้วย external_id ที่รับรองไว้ การสร้างสำเร็จไม่แปลว่าขนส่งเข้ารับแล้ว และค่า charge ไม่ใช่หลักฐาน COD โอนแล้ว

## OP03: รายการและค้นหาพัสดุ

`GET /api/v3/shipment` | query | ไม่มี body

| Query | ตาม description |
| --- | --- |
| `viewpoint` | required: `all`, `waiting`, `on_delivery`, `delivered`, `on_return`, `returned`, `claimed`, `canceled` |
| `search` | ค้นด้วย tracking; ไม่รับรองการค้นด้วย reference_no/external_id |
| `is_cod` | bool โดยคำอธิบายใช้ 1/0 |
| `start`, `end` | string วันที่เริ่ม/จบ; format และ timezone ไม่ระบุ |
| `limit` | integer default 15; max ไม่ระบุ |
| `page` | integer default 1 |
| `sort` | example `create_date`; ทิศทางเรียงไม่ระบุ |

parameter array จริงระบุเพียง `viewpoint`, `limit`; รายการที่เหลืออยู่ใน description ต้องยืนยันการรองรับ

```text
GET <CONFIRMED_BASE>/api/v3/shipment?viewpoint=all&limit=10&page=1&search=<TRACKING>&key=<KEY>&timestamp=<MS>&signature=<SIGNATURE>
```

**ตอบกลับ:** 200 JSON `data[]` มีเลขติดตาม carrier/status ขนาด/น้ำหนัก reference/remark วันสร้าง/แก้ และกลุ่ม `estimate_*`, `actual_*` เช่น ค่าส่ง COD ภาษี ค่าพื้นที่และประกัน; หลายค่าเป็น decimal string มี `links`, `meta`, `request_id` ดูบัญชีฟิลด์ครบใน FIELD_CATALOG

**ผิดพลาด:** 400 `ERROR_VALIDATION` ตัวอย่างขาด viewpoint

**ข้อจำกัด:** host production ต่างจาก operation อื่น; pagination links ใน example ชี้ HTTP host เก่า อย่าตาม URL โดยตรงพร้อม auth ให้ประกอบคำขอใหม่บน host ที่ยืนยัน; ไม่พบ endpoint ติดตามละเอียดรายจุดสแกนหรือ proof of delivery โดยเฉพาะ ค่า `closed` มีใน webhook แต่ไม่มีใน viewpoint list

## OP04: พิมพ์ใบปะหน้า

`POST /api/v3/shipment/print` | JSON

**ข้อมูลรับเข้า:** `carrier_code` required string, `tracking_number` required array, `show_order` ตัวเลือก string 0/1 ตามตาราง แต่ example เป็น number

```json
{"show_order": 1, "carrier_code": "<ENABLED_CARRIER_CODE>", "tracking_number": ["<TRACKING_NUMBER>"]}
```

**ตอบกลับ:** 200 ระบุ `text/plain` แต่ example เป็นข้อความ JSON ที่มี `code`, `message`, `data.link`, `request_id`; `data.link` เป็น signed PDF URL ในตัวอย่าง ไม่ใช่ PDF bytes โดยตรง

**ผิดพลาด:** map มี 400 `ERROR_VALIDATION`; description ยังระบุ 500 แต่ไม่มี response entry

**ข้อจำกัด:** summary ระบุ 4x3 แต่ไม่ระบุหน่วย/ตัวเลือกขนาด; จำนวนพัสดุสูงสุดต่อครั้ง อายุ link การพิมพ์ซ้ำ และ mixed carriers ไม่ระบุ เสนอแยก batch ตาม carrier และตรวจ response Content-Type/JSON อย่างมีขอบเขต เก็บลิงก์ใบปะหน้าเป็นข้อมูลจำกัดสิทธิ์ ไม่คัดลอก signed URL ลง Git/log สาธารณะ

## OP05: ยกเลิกรายการส่ง

`PUT /api/v3/shipment/cancel/{TRACKING_NUMBER}` | path parameter ตาม description

**ข้อมูลรับเข้า:** เลขติดตามใน path; YAML key ใส่เลขตัวอย่างถาวร ไม่มี parameter declaration; body schema type object แต่ example เป็น empty string จึงยังสรุปไม่ได้ว่าต้องส่ง body ว่างแบบใด

**ตอบกลับ:** 200 JSON `data.status`, `timestamp`, `request_id`

**ผิดพลาด:** 400 `ERROR_VALIDATION` ตัวอย่างไม่พบ tracking

**ข้อจำกัด:** ไม่ระบุสถานะที่ยกเลิกได้, คืนเครดิตเมื่อไร, ค่าธรรมเนียม, ผลเมื่อยกเลิกซ้ำ และความสัมพันธ์กับ pickup ต้องยืนยัน การยกเลิก shipment ไม่ใช่การยกเลิก sale/order

## OP06: เช็กราคา

`POST /api/v3/shipment/check-price` ตาม YAML แต่ตาราง environment เขียน **GET** ทั้งสอง environment ต้องยืนยันก่อนใช้งาน

**ข้อมูลรับเข้า:** example เป็น JSON มี `box_width`, `box_height`, `box_length`, `box_weight`, `carriers_code` array และ `origin`/`destination` ที่มี `county`, `city`, `state`, `postcode` ไม่มีตาราง required และไม่มี COD/insurance ใน request example ของ operation นี้; `carriers_code` เป็นพหูพจน์ ต่างจาก `carrier_code` ของ OP02

```json
{
  "box_width": 20, "box_height": 10, "box_length": 30, "box_weight": 1200,
  "carriers_code": ["<ENABLED_CARRIER_CODE>"],
  "origin": {"county": "<SUBDISTRICT>", "city": "<DISTRICT>", "state": "<PROVINCE>", "postcode": "<POSTCODE>"},
  "destination": {"county": "<SUBDISTRICT>", "city": "<DISTRICT>", "state": "<PROVINCE>", "postcode": "<POSTCODE>"}
}
```

**ตอบกลับ:** 200 JSON `data[]`: `carrier`, `carrier_code`, `remote_price`, `tourism_price`, `island_price`, `price`, `total`, `is_pickup` number, `delivery_time` string; มี `request_id` ราคาเป็น string ใน example

**ผิดพลาด:** ไม่มีตัวอย่าง error/response code อื่นใน operation นี้ ไม่ตีความว่าระบบไม่มี error

**ข้อจำกัด:** ราคาในผลตรวจยังไม่ยืนยันว่ารวม COD/ภาษี/ประกัน/ค่ารับพัสดุครบ อย่าเสนอเป็นยอดสุดท้าย มี OP14 สำหรับ actual rate/adjustments ภายหลัง

## OP07: ตรวจที่อยู่

`GET /api/v3/shipment/check-address` | query

**ข้อมูลรับเข้า:** `postcode` schema integer คำอธิบาย Required, `carrier_code` string คำอธิบาย Required, `limit` integer default 10; example ใช้ `THAIPOST` ขณะที่รายการบริการใช้ `EMS_SPEED` ต้องขอ mapping carrier family กับ service code

**ตอบกลับ:** 200 `application/json` แต่ content ไม่มี schema/example จึงยังไม่มีรายชื่อฟิลด์ผลตรวจที่ยืนยันได้

**ผิดพลาด/ข้อจำกัด:** ไม่ระบุ error, ผลที่อยู่ไม่ตรง, หลายตำบลต่อรหัสไปรษณีย์ หรือ coverage เสนอเก็บ postcode เป็น string ภายในและแปลงที่ adapter ตามสเปกที่ยืนยัน ไม่อนุมาน API ส่งกลับค่าพื้นที่ห่างไกลจากชื่อ endpoint

## OP08: ขอเติมเครดิต

`POST /api/v3/wallet` ตาม YAML แต่ตาราง environment เขียน **GET** | `multipart/form-data`

**ข้อมูลรับเข้า:** `attachment` required binary (.jpg, .png, .pdf ตาม description), `amount` required integer, `payment_code` required string ซึ่งมี `BANK_TRANSFER` ในคำอธิบาย, `remark` ตัวเลือก string ไม่ระบุ max file size/หน่วยเงิน/ทศนิยม; required ไม่ได้ใส่ใน schema array

```text
POST <CONFIRMED_BASE>/api/v3/wallet?<SIGNED_QUERY>
Content-Type: multipart/form-data; boundary=<GENERATED_BY_HTTP_CLIENT>
Fields: attachment=<APPROVED_SLIP_FILE>, amount=<AMOUNT>, payment_code=BANK_TRANSFER, remark=<OPTIONAL_REMARK>
```

**ตอบกลับ:** 200 JSON `message`, `data` เป็นข้อความ `create wallet deposit`, `request_id`; ไม่ใช่หลักฐานว่าเงินถูกอนุมัติหรือใช้ได้แล้ว

**ผิดพลาด:** 400 `ERROR_VALIDATION`; example ระบุ `should approve wallet before add deposit.` จึงต้องถาม approval flow และเงื่อนไขรายการค้างก่อนส่งซ้ำ

**ข้อจำกัด:** จำกัด owner/admin ตาม Brief ไม่มีการเติมเงินจริงในงานเอกสารนี้ และยังไม่ยืนยันว่าบัญชี J NAC ใช้ wallet prepaid หรือ invoice/postpaid; ไม่มี approve/status endpoint ของ deposit ในชุดนี้

## OP09: ประวัติเงินเข้าออก

`GET /api/v3/wallet` | ไม่มี request body หรือ query ที่ประกาศใน operation

**ตอบกลับ:** 200 JSON `data[]` มี `txn_type`, `reference`, `deposit`, `withdraw`, `create_date`, `update_date`; มี `links`, `meta`, `timestamp`, `request_id` ตัวเลขเงินเป็น string; description เขียน `date` แต่ example ใช้ `data`

**ผิดพลาด:** description ระบุ 400 `ERROR_VALIDATION` แต่ไม่มี response entry

**ข้อจำกัด:** ตัวอย่าง pagination มี `page` แต่ไม่มี query contract; ไม่เห็น available balance หรือ endpoint กระทบยอด COD จากธนาคาร ไม่ใช้ผลรวมประวัติที่อาจอ่านไม่ครบแทนยอดใช้ได้ และไม่ตาม HTTP pagination URL เก่าโดยตรง

## OP10: รายชื่อบริการขนส่ง

`GET /api/v3/carrier/list` | query `limit` integer example 25; ไม่ระบุค่า max/default ที่แน่นอน

**ตอบกลับ:** 200 JSON `data[]` มี `name`, `description`, `code`; มี `links`, `meta`, `request_id` ตัวอย่างแสดงบริการหลายราย แต่ไม่รับรองว่าบัญชี J NAC เปิดทั้งหมด

**ผิดพลาด:** description ระบุ 400 `ERROR_VALIDATION` แต่ response map มีเพียง 200

**ข้อจำกัด:** ไม่มี capability matrix เรื่อง COD, pickup, max weight, เขตบริการ หรือระยะเวลาตัดรอบใน schema ใช้ API เป็นแหล่ง code แล้วตรวจสิทธิ์ merchant แยก อย่า hardcode รายชื่อ/ราคาจาก PDF

## OP11: เรียกรถเข้ารับ

`POST /api/v3/pickup` ตาม YAML แต่ environment table เขียน **GET** | JSON

**ข้อมูลรับเข้า:** ตารางชื่อ Response Body แต่ requestBody มีฟิลด์เดียวกัน: required string `carrier_code`, `warehouse_no`, `fullname`, `address`, `mobile`, `county`, `city`, `state`, `postcode`; required integer `estimate_parcel` ตัวอย่าง warehouse_no = `001` ไม่ได้แปลว่าเป็นรหัสคลังของ J NAC

**ตอบกลับ:** 200 `application/json` ว่าง ไม่มี schema/example โดยเฉพาะไม่มีรูปแบบ pickup ID ใน success ที่ยืนยันได้

**ผิดพลาด:** description ระบุ 400 `ERROR_VALIDATION` แต่ไม่ประกาศ response entry

**ข้อจำกัด:** ไม่พบวัน/ช่วงเวลานัดหมาย, รายการ tracking ที่ผูก pickup, การลงทะเบียน warehouse, max parcel หรือ lookup หลัง timeout ต้องถามว่า ticket จาก OP15 เชื่อมกับคำขออย่างไร

## OP12: ยกเลิกรถเข้ารับ

`PUT /api/v3/pickup/{pickup_id}/cancel` ตาม YAML แต่ environment table เขียน **GET**

**ข้อมูลรับเข้า:** path `pickup_id` required string; requestBody content ว่าง ไม่ประกาศข้อมูลอื่น

**ตอบกลับ:** 200 `application/json` ไม่มี schema/example

**ผิดพลาด:** description ระบุ 400 `ERROR_VALIDATION` แต่ไม่มี response entry

**ข้อจำกัด:** ยังไม่ยืนยันว่า `pickup_id` ตรงกับ `ticket_pickup_id` ใน webhook, สถานะที่ยกเลิกได้ และผลต่อ shipment ต้องแยกการยกเลิก pickup ออกจากการยกเลิกพัสดุ

## ข้อกำหนดร่วมของ webhook OP13-OP15

ผู้ให้บริการ POST เข้า URL ที่ CoreBiz กำหนดเอง ทั้งสาม path ใน YAML เป็นตัวอย่าง ไม่มีหลักฐานว่าผู้ให้บริการรองรับ Supabase user JWT; ต้องมีวิธียืนยันคำขอของผู้ให้บริการแยกจาก login พนักงาน

ตารางในต้นฉบับใช้ชื่อ Response Body แต่เนื้อหาคือ callback payload ที่ CoreBiz รับเข้า ตัวอย่าง response ที่ CoreBiz ต้องตอบไม่มี schema ระบุ 200 ใน map และ 400 ใน description

**ข้อมูลที่ขาดร่วมกัน:** signature/header, signing secret, replay window, event ID, retry/backoff, timeout, วิธีลงทะเบียน URL, การเปลี่ยน URL และลำดับส่ง event

**ข้อเสนอ:** ตรวจผู้ส่งและ merchant, validate payload, บันทึก event ให้สำเร็จก่อนตอบรับ, ประมวลผลแบบ idempotent และไม่ให้ event เก่าย้อนสถานะใหม่; ห้าม fetch ค่า `url` ใน payload หรือใช้เป็น callback destination โดยอัตโนมัติ

## OP13: สถานะพัสดุ

`POST /path-status` | รับ JSON ที่ backend ของ partner

**ข้อมูลรับเข้า:** required `url`, `event`, `object` = `shipment`, `merchant_code`, `data`; data มี required `tracking_number`, `carrier`, `cod_amount`, `status`, `weight`, `width`, `length`, `height`, `updated`

- event: `shipment.waiting`, `shipment.on_delivery`, `shipment.delivered`, `shipment.on_return`, `shipment.returned`, `shipment.claimed`, `shipment.canceled`, `shipment.closed`
- status เป็นคำหลังจุดตามรายการข้างต้น; `closed` หมายถึงปิดรายการที่มีปัญหาตาม description
- น้ำหนัก g และขนาด cm; `cod_amount` ตาราง string แต่ example number
- `updated` อธิบาย GMT+7 แต่ example เป็น ISO 8601 `+00:00`; parse offset จากค่าจริง ไม่บวก 7 ซ้ำ

**ตอบกลับ:** CoreBiz ตอบ 200 ตามสเปก ไม่มี body contract; 400 กล่าวถึงใน description เท่านั้น

**ข้อจำกัด:** carrier ตัวอย่างเป็น `THAIPOST` ต่างจาก service code; ไม่ใช้ delivered เป็นหลักฐานรับชำระ COD และไม่ map canceled/returned ไป order อัตโนมัติ

## OP14: ราคาและการปรับราคา

`POST /path-price` | รับ JSON | **หนึ่ง operation รองรับสอง event**

ทั้งสอง event ระบุ required envelope `partner_id` integer, `callback_version` string, `url`, `event`, `object` = `shipment`, `merchant_code`, `data`

| Event | ข้อมูล data ตาม description |
| --- | --- |
| `shipment.price` | required `tracking_number`, `carrier`, `weight`, `width`, `length`, `height`, `updated`; optional `price_surcharge` ซึ่งถ้ามีระบุ `type` = deposit/withdraw และ `price` |
| `shipment.company_price` | required ข้อมูลเดียวกัน พร้อม `company_id`, `rate_version_id`, `per_txn_margin`, `price`, `cod_price`, `cod_tax`, `cod_price_before_vat`, `cod_price_vat`, `remote_price`, `tourism_price`, `on_holiday_price`, `warranty_price`, `island_price`, `is_same_province`, `use_rate_calculate`, `origin_region_name`, `destination_region_name`; optional `price_surcharge` |

`shipment.company_price` ส่งเฉพาะเมื่อเปิด Company Rate ตาม description ชนิดเงินส่วนใหญ่ระบุ float; ค่า company/rate ID เป็น integer และ `is_same_province` boolean

**ตอบกลับ:** CoreBiz ตอบ 200 ไม่มี body contract; description ระบุ 400

**ข้อจำกัด:** `shipment.price` ไม่มี top-level `data.price` ใน schema/example ที่ให้มา จึงไม่ควรเอา `price_surcharge.price` ไปแทนยอดค่าขนส่งทั้งหมด ไม่มี transaction ID ที่รับรองการ deduplicate เงิน; ความหมายเครื่องหมาย deposit/withdraw และการรวมสอง event ต้องยืนยัน ไม่รวม `cod_tax` กับ `cod_price_vat` โดยสมมติว่าเป็นคนละภาษี และไม่ใช้ margin/cost ในหน้าลูกค้าหรือ bot

ข้อบกพร่อง OpenAPI: examples สองแบบวางไว้ใต้ `schema.examples` ซึ่งไม่ใช่ตำแหน่งมาตรฐานของ Media Type examples ใน OpenAPI 3.0 จึงอาจหายเมื่อแปลงเป็นเครื่องมือ

## OP15: สถานะรถเข้ารับ

`POST /path-pickup` | รับ JSON

**ข้อมูลรับเข้า:** required `url`, `event`, `object` = `pickup`, `merchant_code`, `data`; data มี required `ticket_pickup_id`, `carrier`, `status`, `staff_name`, `staff_phone`, `estimate_time`, `updated`

- event: `pickup.pending`, `pickup.on_process`, `pickup.completed`, `pickup.canceled`
- status: `pending`, `on_process`, `completed`, `canceled`
- `ticket_pickup_id` ตาราง string แต่ example number; code ตัวอย่าง `FLASH_EXPRESS_SP` ต่างจาก `FLASH_EXPRESS_SPEED`
- `estimate_time` เป็นข้อความสำหรับแสดง เช่นช่วงเวลา ไม่ควร parse เป็นเวลานัดที่แน่นอนเอง; `updated` มี timezone conflict เช่น OP13

**ตอบกลับ:** CoreBiz ตอบ 200 ไม่มี body contract; description ระบุ 400

**ข้อจำกัด:** ชื่อ/เบอร์คนขับเป็นข้อมูลจำกัดสิทธิ์ ต้องกำหนด retention; completed ของ pickup ไม่ใช่ delivered ของ shipment และยังต้องยืนยัน ID mapping กับ OP11/OP12

## ข้อผิดพลาดและการ retry ที่ควรวางแผน

สเปกไม่ได้กำหนด 401/403/409/429, rate limit, `Retry-After`, timeout หรือ error schema ร่วมครบถ้วน ความไม่มีในเอกสารไม่ใช่การรับรองว่าจะไม่เกิด

| เหตุการณ์ | ข้อเสนอการจัดการ |
| --- | --- |
| validation error | แจ้งชื่อฟิลด์ให้พนักงานแก้ ไม่ retry body เดิมอัตโนมัติ |
| auth/config error | หยุดส่งและแจ้งผู้ดูแล ไม่แสดง credential |
| timeout หลัง create/cancel/pickup/deposit | เก็บสถานะผลยังไม่ทราบ ตรวจผลเดิมก่อน ไม่ออก ID ใหม่เพื่อส่งซ้ำเอง |
| 429/5xx ของ read-only request | retry แบบจำกัดจำนวนและมี backoff หลังผู้ให้บริการยืนยันเงื่อนไข |
| callback ซ้ำ/ย้อนลำดับ | เก็บหลักฐานเดิมและเหตุผลที่ไม่เปลี่ยนสถานะ; เงินต้องไม่ลงซ้ำ |
| response ไม่ตรง schema | เก็บ metadata ที่ล้างข้อมูลอ่อนไหว ส่งเข้าคิวตรวจสอบ ไม่ตีความเป็น success ด้วย HTTP อย่างเดียว |

ข้อกำหนดที่ยังขาดรวบรวมเป็นคำถามพร้อมลำดับความสำคัญใน [QUESTIONS.md](QUESTIONS.md)
