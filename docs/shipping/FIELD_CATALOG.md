# บัญชีฟิลด์จากสเปกและตัวอย่าง

อ้างอิง S1 ใน [SOURCES.md](SOURCES.md); รายการนี้ดึงชื่อฟิลด์และชนิดข้อมูลจาก YAML โดยไม่คัดลอกค่าตัวอย่างจริง ข้อมูลที่มาจาก example **ไม่ใช่ schema รับรอง** และไม่กำหนด required ให้อัตโนมัติ อ่านเงื่อนไขบังคับ/ข้อขัดแย้งใน [API_REFERENCE.md](API_REFERENCE.md) ร่วมด้วย

คอลัมน์แหล่งข้อมูลแยก schema กับ example; `number` หมายถึงชนิดที่ parser อ่าน ไม่ยืนยัน integer/หน่วยเงิน/ความละเอียด ส่วน array ตรวจทุกสมาชิกที่ตัวอย่างมีและรวมชนิดที่พบ หากไม่มี schema/example ให้ระบุว่าไม่กำหนด ห้ามสร้าง field เพิ่มเอง

## OP01: POST /api/v3/merchant

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `full_name` | string | example |
| `company_name` | string | example |
| `sms_name` | string | example |
| `email` | string | example |
| `address` | string | example |
| `county` | string | example |
| `city` | string | example |
| `state` | string | example |
| `postcode` | string | example |
| `mobile1` | string | example |
| `mobile2` | string | example |
| `reference` | string | example |

### Response HTTP 201

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | object | example |
| `data.code` | string | example |
| `data.api_key` | string | example |
| `data.api_secret` | string | example |
| `data.name` | string | example |
| `data.company_name` | string | example |
| `data.tax_identification` | string | example |
| `data.sms_name` | string | example |
| `data.address` | string | example |
| `data.county` | string | example |
| `data.city` | string | example |
| `data.state` | string | example |
| `data.mobile1` | string | example |
| `data.mobile2` | string | example |
| `data.email` | string | example |
| `data.reference` | string | example |
| `data.create_date` | string | example |
| `data.update_date` | string | example |
| `data.carriers` | array | example |
| `data.carriers[]` | object | example |
| `data.carriers[].code` | string | example |
| `data.carriers[].name` | string | example |
| `data.carriers[].description` | string | example |
| `data.carriers[].create_date` | string | example |
| `data.carriers[].update_date` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP02: POST /api/v3/shipment

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `carrier_code` | string | example |
| `box_width` | number | example |
| `box_height` | number | example |
| `box_length` | number | example |
| `box_weight` | number | example |
| `cod_account` | number | example |
| `cod_amount` | number | example |
| `reference_no` | string | example |
| `external_id` | string | example |
| `origin` | object | example |
| `origin.fullname` | string | example |
| `origin.address` | string | example |
| `origin.county` | string | example |
| `origin.city` | string | example |
| `origin.state` | string | example |
| `origin.postcode` | string | example |
| `origin.email` | string | example |
| `origin.telephone1` | string | example |
| `destination` | object | example |
| `destination.fullname` | string | example |
| `destination.address` | string | example |
| `destination.county` | string | example |
| `destination.city` | string | example |
| `destination.state` | string | example |
| `destination.postcode` | string | example |
| `destination.email` | string | example |
| `destination.telephone1` | string | example |
| `products` | array | example |
| `products[]` | object | example |
| `products[].qty` | number | example |
| `products[].code` | string | example |
| `products[].name` | string | example |
| `products[].price` | string | example |
| `products[].weight` | number | example |
| `is_warranty` | boolean | example |
| `product_price` | number | example |

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | object | example |
| `data.tracking_number` | string | example |
| `data.charge` | string | example |
| `data.wallet_balance` | string | example |
| `timestamp` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

### Response HTTP 500

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |

## OP03: GET /api/v3/shipment

### Parameters

| ชื่อ | ตำแหน่ง | schema type | required ในโครงสร้าง |
| --- | --- | --- | --- |
| `viewpoint` | query | string | ไม่ระบุ |
| `limit` | query | integer | ไม่ระบุ |

ไม่มี requestBody declaration

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | array | example |
| `data[]` | object | example |
| `data[].tracking_number` | string | example |
| `data[].carrier_code` | string | example |
| `data[].status` | string | example |
| `data[].box_height` | string | example |
| `data[].box_length` | string | example |
| `data[].box_width` | string | example |
| `data[].weight` | string | example |
| `data[].estimate_price` | string | example |
| `data[].estimate_cod_amount` | string | example |
| `data[].estimate_cod_price` | string | example |
| `data[].estimate_cod_price_before_vat` | string | example |
| `data[].estimate_cod_price_vat` | string | example |
| `data[].estimate_cod_tax` | string | example |
| `data[].estimate_on_holiday_price` | string | example |
| `data[].estimate_per_txn_margin` | string | example |
| `data[].estimate_remote_price` | string | example |
| `data[].estimate_tourism_price` | string | example |
| `data[].estimate_island_price` | string | example |
| `data[].estimate_warranty_price` | string | example |
| `data[].reference_no` | string | example |
| `data[].remark` | string | example |
| `data[].actual_price` | string | example |
| `data[].actual_cod_amount` | string | example |
| `data[].actual_cod_price` | string | example |
| `data[].actual_cod_price_before_vat` | string | example |
| `data[].actual_cod_price_vat` | string | example |
| `data[].actual_on_holiday_price` | string | example |
| `data[].actual_per_txn_margin` | string | example |
| `data[].actual_remote_price` | string | example |
| `data[].actual_tourism_price` | string | example |
| `data[].actual_warranty_price` | string | example |
| `data[].create_date` | string | example |
| `data[].update_date` | string | example |
| `links` | object | example |
| `links.first` | string | example |
| `links.last` | string | example |
| `links.prev` | null | example |
| `links.next` | null | example |
| `meta` | object | example |
| `meta.current_page` | number | example |
| `meta.from` | number | example |
| `meta.last_page` | number | example |
| `meta.path` | string | example |
| `meta.per_page` | string | example |
| `meta.to` | number | example |
| `meta.total` | number | example |
| `request_id` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP04: POST /api/v3/shipment/print

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `show_order` | number | example |
| `carrier_code` | string | example |
| `tracking_number` | array | example |
| `tracking_number[]` | string | example |

### Response HTTP 200

**Content-Type:** `text/plain`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | number | example |
| `message` | string | example |
| `data` | object | example |
| `data.link` | string | example |
| `request_id` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP05: PUT /api/v3/shipment/cancel/{TRACKING_NUMBER}

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | string | example |

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | object | example |
| `data.status` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP06: POST /api/v3/shipment/check-price

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `box_width` | number | example |
| `box_height` | number | example |
| `box_length` | number | example |
| `box_weight` | number | example |
| `carriers_code` | array | example |
| `carriers_code[]` | string | example |
| `origin` | object | example |
| `origin.county` | string | example |
| `origin.city` | string | example |
| `origin.state` | string | example |
| `origin.postcode` | string | example |
| `destination` | object | example |
| `destination.county` | string | example |
| `destination.city` | string | example |
| `destination.state` | string | example |
| `destination.postcode` | string | example |

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | array | example |
| `data[]` | object | example |
| `data[].carrier` | string | example |
| `data[].carrier_code` | string | example |
| `data[].remote_price` | string | example |
| `data[].tourism_price` | string | example |
| `data[].island_price` | string | example |
| `data[].price` | string | example |
| `data[].total` | string | example |
| `data[].is_pickup` | number | example |
| `data[].delivery_time` | string | example |
| `request_id` | string | example |

## OP07: GET /api/v3/shipment/check-address

### Parameters

| ชื่อ | ตำแหน่ง | schema type | required ในโครงสร้าง |
| --- | --- | --- | --- |
| `postcode` | query | integer | ไม่ระบุ |
| `carrier_code` | query | string | ไม่ระบุ |
| `limit` | query | integer | ไม่ระบุ |

ไม่มี requestBody declaration

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example

## OP08: POST /api/v3/wallet

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `multipart/form-data`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `attachment` | string / binary | schema; ไม่ระบุ required |
| `amount` | integer | schema; ไม่ระบุ required |
| `remark` | string | schema; ไม่ระบุ required |
| `payment_code` | string | schema; ไม่ระบุ required |

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `message` | string | example |
| `data` | string | example |
| `request_id` | string | example |

### Response HTTP 400

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `code` | string | example |
| `message` | string | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP09: GET /api/v3/wallet

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

ไม่มี requestBody declaration

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | array | example |
| `data[]` | object | example |
| `data[].txn_type` | string | example |
| `data[].reference` | string | example |
| `data[].deposit` | string | example |
| `data[].withdraw` | string | example |
| `data[].create_date` | string | example |
| `data[].update_date` | string | example |
| `links` | object | example |
| `links.first` | string | example |
| `links.last` | string | example |
| `links.prev` | null | example |
| `links.next` | null | example |
| `meta` | object | example |
| `meta.current_page` | number | example |
| `meta.from` | number | example |
| `meta.last_page` | number | example |
| `meta.path` | string | example |
| `meta.per_page` | number | example |
| `meta.to` | number | example |
| `meta.total` | number | example |
| `timestamp` | string | example |
| `request_id` | string | example |

## OP10: GET /api/v3/carrier/list

### Parameters

| ชื่อ | ตำแหน่ง | schema type | required ในโครงสร้าง |
| --- | --- | --- | --- |
| `limit` | query | integer | ไม่ระบุ |

ไม่มี requestBody declaration

### Response HTTP 200

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `data` | array | example |
| `data[]` | object | example |
| `data[].name` | string | example |
| `data[].description` | string | example |
| `data[].code` | string | example |
| `links` | object | example |
| `links.first` | string | example |
| `links.last` | string | example |
| `links.prev` | null | example |
| `links.next` | null | example |
| `meta` | object | example |
| `meta.current_page` | number | example |
| `meta.from` | number | example |
| `meta.last_page` | number | example |
| `meta.path` | string | example |
| `meta.per_page` | number | example |
| `meta.to` | number | example |
| `meta.total` | number | example |
| `request_id` | string | example |

## OP11: POST /api/v3/pickup

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `carrier_code` | string | example |
| `warehouse_no` | string | example |
| `fullname` | string | example |
| `address` | string | example |
| `mobile` | string | example |
| `county` | string | example |
| `city` | string | example |
| `state` | string | example |
| `postcode` | string | example |
| `estimate_parcel` | number | example |

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example

## OP12: PUT /api/v3/pickup/{pickup_id}/cancel

### Parameters

| ชื่อ | ตำแหน่ง | schema type | required ในโครงสร้าง |
| --- | --- | --- | --- |
| `pickup_id` | path | string | true |

### Request / Callback body

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example

## OP13: POST /path-status

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `url` | string | example |
| `event` | string | example |
| `object` | string | example |
| `merchant_code` | string | example |
| `data` | object | example |
| `data.tracking_number` | string | example |
| `data.carrier` | string | example |
| `data.cod_amount` | number | example |
| `data.status` | string | example |
| `data.weight` | number | example |
| `data.width` | number | example |
| `data.length` | number | example |
| `data.height` | number | example |
| `data.updated` | string | example |

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example

## OP14: POST /path-price

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `partner_id` | number | example |
| `callback_version` | string | example |
| `url` | string | example |
| `event` | string | example |
| `object` | string | example |
| `merchant_code` | string | example |
| `data` | object | example |
| `data.tracking_number` | string | example |
| `data.carrier` | string | example |
| `data.weight` | number | example |
| `data.width` | number | example |
| `data.length` | number | example |
| `data.height` | number | example |
| `data.updated` | string | example |
| `data.price_surcharge` | object | example |
| `data.price_surcharge.type` | string | example |
| `data.price_surcharge.price` | number | example |
| `data.company_id` | number | example |
| `data.rate_version_id` | number | example |
| `data.per_txn_margin` | number | example |
| `data.price` | number | example |
| `data.cod_price` | number | example |
| `data.cod_tax` | number | example |
| `data.cod_price_before_vat` | number | example |
| `data.cod_price_vat` | number | example |
| `data.remote_price` | number | example |
| `data.tourism_price` | number | example |
| `data.on_holiday_price` | number | example |
| `data.warranty_price` | number | example |
| `data.island_price` | number | example |
| `data.is_same_province` | boolean | example |
| `data.use_rate_calculate` | string | example |
| `data.origin_region_name` | string | example |
| `data.destination_region_name` | string | example |

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example

## OP15: POST /path-pickup

ไม่มี parameter declaration ใน operation; อาจยังมี query/path ที่ระบุใน description ดูคู่มือหลัก

### Request / Callback body

**Content-Type:** `application/json`

| ฟิลด์ | ชนิดที่พบ | แหล่งข้อมูล |
| --- | --- | --- |
| `(root)` | object | example |
| `url` | string | example |
| `event` | string | example |
| `object` | string | example |
| `merchant_code` | string | example |
| `data` | object | example |
| `data.ticket_pickup_id` | number | example |
| `data.carrier` | string | example |
| `data.status` | string | example |
| `data.staff_name` | string | example |
| `data.staff_phone` | string | example |
| `data.estimate_time` | string | example |
| `data.updated` | string | example |

### Response HTTP 200

**Content-Type:** `application/json`

ไม่ได้ระบุฟิลด์ใน schema หรือ example
