# Google Sheet → Inventory : Instant Sync Setup

ปกติระบบจะดึงสต็อกจาก sheet **ทุก 15 นาที** ผ่าน pg_cron
ถ้าต้องการให้ **อัปเดตทันทีที่มีการแก้ไขใน sheet** ให้เปิดใช้ Apps Script ตามขั้นตอนนี้

---

## 1. เปิด Apps Script editor ของ sheet

1. เปิด sheet ที่ https://docs.google.com/spreadsheets/d/1c3U81eazLDTMQTdDScObASikKgYJf_qmKabn4Lyf1Og/edit
2. เมนู **Extensions → Apps Script**
3. ตัว editor จะเปิด tab ใหม่ขึ้นมา

## 2. แปะโค้ดจาก `docs/apps-script/inventory-sync.gs`

1. ลบโค้ดเก่าใน `Code.gs` ออกให้หมด
2. คัดลอกเนื้อหา `docs/apps-script/inventory-sync.gs` มาแปะแทน
3. กดบันทึก (💾 หรือ `Ctrl+S`) ตั้งชื่อโปรเจ็กต์ เช่น `corebiz-inventory-sync`

## 3. ใส่ secret ใน Script Properties

โค้ดอ่าน secret จาก property ไม่ได้ hard-code ไว้ในไฟล์

1. ใน Apps Script editor → คลิก ⚙️ **Project Settings** (ทางซ้าย)
2. เลื่อนลง section **Script Properties** → กด **Add script property**
3. ใส่:
   - Property: `SYNC_SECRET`
   - Value: `479d1e629d1c8a0d0741a72f035f1056e67efb9b7096d92223d64a86e62e6022`
4. กด **Save script properties**

> ⚠️ ค่า secret นี้ตรงกับใน Edge Function `sync-inventory-from-sheet`
> ถ้าวันนึงต้อง rotate ต้องเปลี่ยนทั้ง 2 ที่พร้อมกัน

## 4. ติดตั้ง trigger `onEditTrigger`

simple `onEdit` ไม่มีสิทธิ์เรียก `UrlFetchApp` ต้องใช้ **installable trigger**

1. ใน Apps Script editor → คลิก ⏰ **Triggers** (ทางซ้าย)
2. กด **Add Trigger** (มุมขวาล่าง)
3. ตั้งค่าตามนี้:
   - Choose which function to run: **`onEditTrigger`**
   - Choose which deployment should run: **Head**
   - Select event source: **From spreadsheet**
   - Select event type: **On edit**
   - Failure notification settings: **Notify me immediately** (แนะนำ)
4. กด **Save**
5. Google จะขอ permission — กด **Allow** (script จะรันด้วยสิทธิ์ของ owner sheet)

## 5. ทดสอบ

1. เปิด sheet
2. เปลี่ยนค่า stock ของ SKU ใดสักตัว
3. รอประมาณ **3 วินาที** (debounce)
4. กลับมาที่ CoreBiz Inventory page → กด **🕐 History** ในแถบเครื่องมือ
5. จะเห็น row ใหม่ ที่ source = `Webhook` ขึ้นมาทันที + สต็อกใน UI อัปเดตเอง

ถ้าไม่ขึ้น:
- เช็ค Apps Script Editor → **Executions** (ทางซ้าย) ดู error
- ตรวจว่า SYNC_SECRET ใน Script Properties ตรงกับใน Edge Function
- ตรวจว่า trigger ถูกตั้งเป็น `From spreadsheet / On edit`

---

## เกิดอะไรขึ้นเบื้องหลัง

```
ลูกค้าแก้ cell ใน sheet
       │
       ▼  (Apps Script onEditTrigger ทำงาน)
debounce 2 วินาที (ปล่อยให้แปะหลายเซลล์เสร็จก่อน)
       │
       ▼
POST https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/
     sync-inventory-from-sheet?source=webhook
header: x-sync-secret: ********
       │
       ▼  (Edge Function เดิมที่ pg_cron + Sync Sheet button ใช้ร่วมกัน)
ดึง sheet → match SKU → update inventory.quantity
เขียน log ใน inventory_sync_logs (source='webhook')
       │
       ▼
ฝั่ง CoreBiz: useRealtimeTable('inventory') + ('inventory_sync_logs')
              เห็น row ใหม่ → reload หน้าอัตโนมัติ
```

cron 15 นาทียังทำงานต่อ — เป็น safety net ถ้า Apps Script ถูก disable
หรือ Google Sheet ทำ batch edit ที่ trigger ไม่ทัน

---

## ขีดจำกัด / quota ที่ควรรู้

| ตัวจำกัด | จำนวน | หมายเหตุ |
|---|---|---|
| Apps Script `UrlFetchApp` ต่อวัน | 20,000 calls | per Google account |
| Apps Script trigger executions | 6 hours/day | ปกติเรียก < 1 วินาที = ใช้น้อยมาก |
| Lock timeout | 0 ms (try-lock) | ถ้ามี sync ค้างอยู่จะข้ามไม่รัน — รอตัวต่อไป |
| Debounce | 2,000 ms | ป้องกันการแปะ paste 100 cells แล้วยิง 100 webhook |

ใช้งานปกติของบริษัทขนาดกลางจะไม่เกิน quota เลย
