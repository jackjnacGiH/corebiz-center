# Phase 0 — Abrasives SEO / AI Search Baseline

วันที่ตรวจ: 17 กรกฎาคม 2026<br>
ขอบเขต: ขัด ตัด เจียร และ Abrasives เท่านั้น<br>
สถานะ: Read-only audit — ไม่มีการแก้โค้ด เปลี่ยน URL หรือ Deploy

## Executive summary

J NAC มีฐานข้อมูลสินค้าบน `jnac.online` และฐานเนื้อหาเดิมบน `jnac.co.th` ที่แข็งแรงพอจะต่อยอด แต่สองโดเมนกำลังครอบคลุมรุ่นสินค้าเดียวกันหลายกลุ่มโดยยังไม่มีแผนแบ่งหน้าที่ชัดเจน จุดเร่งด่วนที่สุดคือ SKU `2020003264` ที่อยู่ใน Sitemap แต่เปิดไม่ได้, Performance หน้าหมวดที่โหลดสินค้า 515 รายการพร้อมกัน, การไม่มี Analytics บน `jnac.online`, Branding `JNAC by CoreBiz`, และการขาด Author/วันที่/Structured Data บน `jnac.co.th`

ผลค้นหาเบื้องต้นชี้ว่า `jnac.co.th` ยังมี Search equity สำหรับคำค้นแบบชื่อรุ่น เช่น XA911 แต่ J NAC ยังไม่เด่นในคำถามกว้างที่ลูกค้าใช้เลือกสินค้า เช่น วิธีเลือกเบอร์กระดาษทราย หรือ Fiber Disc เทียบ Flap Disc ดังนั้นยังไม่ควรย้ายหรือลบหน้าเดิมจนกว่าจะได้ข้อมูล Google Search Console และทำ URL ownership matrix เสร็จ

## วิธีตรวจ

- อ่าน Sitemap และ Robots ของสองโดเมน
- ตรวจ HTTP status, Metadata, H1, Canonical และ JSON-LD จากหน้า Live
- ใช้ Playwright ตรวจหน้า Desktop และ Mobile ที่ 390×844
- ใช้ Lighthouse Mobile Lab ตรวจ Performance, Accessibility และ SEO
- ตรวจ Google/Search-visible results ด้วยคำถามและคำค้นชื่อรุ่นตัวอย่าง
- เปรียบเทียบชื่อรุ่นระหว่างสองโดเมน
- ไม่ใช้ Ahrefs, Paid API, Paid PR หรือเครื่องมือเสียเงิน

## 1. URL inventory

### jnac.online

Sitemap มีทั้งหมด 559 URLs:

| ประเภท | จำนวน |
|---|---:|
| หน้าแรก | 1 |
| วิธีสั่งซื้อ | 1 |
| Knowledge | 1 |
| Products | 1 |
| Category | 3 |
| Product group | 37 |
| Product | 515 |

ข้อสังเกต:

- `/c/abrasives` แสดงสินค้า 515 รายการทั้งหมดในหน้าเดียว
- หน้า Category ระบุว่ามีสินค้าพร้อมส่ง 204 รายการ แต่ข้อความและสถานะต้องยืนยันกับข้อมูลจริงก่อนนำไปทำ Claim เชิงการตลาด
- SKU `2020003264` อยู่ใน Sitemap เป็น `/p/2020003264%20`
- ทั้ง `/p/2020003264` และ `/p/2020003264%20` ตอบ 404 จาก Browser จริง
- Sitemap มี SKU ที่มี Whitespace ต่อท้ายเพียงรายการเดียว คือ `2020003264%20`
- หน้า `/compare` ยังไม่อยู่บน Production และตอบ 404 ณ เวลาตรวจ แม้ Repo มีไฟล์ Comparison ที่ยังไม่ถูก Deploy

### jnac.co.th

- Sitemap มี 220 URLs
- ตรวจจาก Title/URL พบ Candidate ที่เกี่ยวกับ Abrasives ประมาณ 186 URLs แต่ต้องยืนยันรายหน้าก่อนใช้เป็น Migration list
- Site มีเนื้อหาเดิมครอบคลุม Fiber Disc, กระดาษทรายน้ำ/แห้ง, Hook and Loop, PSA, Flap Disc, ล้อทราย, ใยขัด และหินขัด
- Automated crawler แบบพร้อมกันถูกระบบเดิมตอบ 503 หลายหน้า แต่ Browser เปิดหน้าเดียวกันได้ จึงยังห้ามสรุปว่าเป็น Broken URL; ต้องตรวจแบบลดความถี่ใน Phase ถัดไป

## 2. Technical baseline

### Mobile Lighthouse lab

| หน้า | Performance | Accessibility | SEO | FCP | LCP | Transfer |
|---|---:|---:|---:|---:|---:|---:|
| `jnac.online/` | 73 | 91 | 100 | 2.1s | 9.8s | 1,828 KiB |
| `jnac.online/c/abrasives` | 69 | 91 | 100 | 2.8s | 9.1s | 4,958 KiB |
| `jnac.online/p/2020002442` | 78 | 93 | 100 | 1.1s | 6.1s | 925 KiB |
| `jnac.co.th/` | 59 | 80 | 83 | 4.1s | 16.8s | 3,911 KiB |
| `jnac.co.th/.../fiber-disc` | 59 | 77 | 92 | 6.6s | 11.6s | 1,541 KiB |

ผล Lab เปลี่ยนแปลงได้ตาม Network และ Server จึงใช้เป็น Baseline เปรียบเทียบหลังแก้ ไม่ใช่ Field Core Web Vitals

### Mobile UX

- `jnac.online` ที่ 390px ไม่พบ Horizontal overflow บนหน้าแรกและหน้า `/c/abrasives`
- Header Mobile ของ Production แสดง Account และ Cart แต่ไม่มี Menu ไป Products, Knowledge และ Contact
- หน้า `/c/abrasives` Render รายการจำนวนมาก ทำให้หน้า HTML/ทรัพยากรหนักและเลื่อนยาว
- `jnac.co.th` ที่ 390px ไม่พบ Horizontal overflow ในหน้าตัวอย่าง แต่ Navigation/DOM มีรายการจำนวนมากและโครงสร้างเก่า

### Crawl / structured data

`jnac.online`:

- `robots.txt` อนุญาต `User-agent: *` และชี้ Sitemap ถูกต้อง
- Homepage มี Organization และ Store JSON-LD
- Product sample มี Product, Offer, FAQPage, BreadcrumbList และ Article JSON-LD
- JSON-LD ที่สุ่มตรวจ Parse ได้ ไม่มี Syntax error
- Article sample มี Author field แต่ยังไม่พบ `dateModified`
- ยังไม่พบ WebSite Schema ในหน้าตัวอย่าง
- Title ของ Category, Group และ Product ยังใช้ suffix `JNAC by CoreBiz`

`jnac.co.th`:

- `robots.txt` ตอบ 200 แต่เป็นไฟล์ว่าง
- หน้าตัวอย่างไม่พบ JSON-LD
- หน้า Fiber Disc มี H1, ตาราง, FAQ และเนื้อหาที่มีประโยชน์ แต่ไม่พบ Author และวันที่เผยแพร่/แก้ไข
- หน้าแรก Source มี H1 จำนวนมากจากโครงสร้าง Template เดิม
- พบ Google Search Console verification meta และ Universal Analytics `UA-83198186-1`; Universal Analytics ไม่ใช่ระบบวัดผลปัจจุบัน

### Analytics

- ไม่พบ GA4/GTM measurement ID บน HTML ของ `jnac.online`
- จึงยังวัด Organic visit, AI referral และ Quote conversion จากหน้า Abrasives แบบเชื่อถือไม่ได้
- การเข้าถึง Search Console/Analytics account เดิมยังไม่ได้รับการยืนยันใน Phase นี้

## 3. Domain overlap

พบชื่อรุ่นร่วมกันอย่างน้อย 7 กลุ่ม:

1. SA331
2. PS33
3. PS36
4. PKE51
5. XA945
6. CS310X
7. XA911

ข้อสรุปเบื้องต้น:

- `jnac.co.th` เหมาะกับ Topic/Family knowledge และรักษา URL ที่มี Search equity
- `jnac.online` เหมาะกับ Product/SKU, ราคา, Stock และ Quote conversion
- ต้องทำ URL ownership matrix ก่อนแก้ Canonical, Redirect หรือย้าย Content
- ห้ามทำสองหน้าที่ตอบ Search intent เดียวกันด้วยเนื้อหาเกือบเหมือนกัน

## 4. Search visibility sample

คำถามกว้างที่ตรวจ:

1. ขัดสแตนเลสใช้ใบขัดอะไร
2. Fiber Disc กับ Flap Disc ต่างกันอย่างไร
3. กระดาษทรายน้ำกับกระดาษทรายแห้งต่างกันอย่างไร
4. วิธีเลือกเบอร์กระดาษทรายขัดเหล็ก

J NAC ไม่ปรากฏในกลุ่มผลลัพธ์เด่นที่เก็บได้จากตัวอย่างนี้ ขณะที่พบ TOA, 3M, FactoriPro, HomePro และเว็บผู้ผลิต/ผู้ขายต่างประเทศ

คำค้นชื่อรุ่น:

- `JNAC XA911` พบทั้งหน้าแรกและหน้ารุ่นของ `jnac.co.th`
- `กระดาษทรายกลมหลังสักหลาด` พบหน้าแรก `jnac.co.th` ร่วมกับ HomePro, Union Abrasive, Klingspor และผู้ขายรายอื่น

ข้อสรุป: Domain เดิมมี Search equity ใน Product/model intent แต่ยังมี Content gap ใน Question/comparison intent

## 5. Competitor / citation candidates

รายการนี้เป็น Search-visible candidates ยังไม่ใช่ AI Share-of-Voice ranking:

| Candidate | จุดแข็งที่พบ |
|---|---|
| 3M Thailand | Brand authority และบทความเปรียบเทียบการใช้งาน |
| TOA | Thai how-to content และคำถามเลือกเบอร์กระดาษทราย |
| Klingspor Thailand | Manufacturer data และ Product taxonomy |
| Muller Asia | ใบตัด/ใบเจียร มาตรฐานและ Safety claims |
| Union Abrasive | Product breadth สำหรับกระดาษทรายและล้อขัด |
| SandpaperThai | Wholesale intent และเนื้อหาเฉพาะกระดาษทราย |
| Victor 1999 | Flap Disc/product-specific content |
| NSKK Marketing | Abrasive catalog และกลุ่มสินค้าอุตสาหกรรม |
| Ksys | Transactional/product listings |
| CST Supply | Technical product/application content |

## 6. AI Search baseline limitation

- สร้าง Prompt Library 80 คำถามแล้วใน `docs/PHASE_0_ABRASIVES_PROMPT_LIBRARY.md`
- การเข้าถึง ChatGPT และ Perplexity แบบ Browser automation ถูก Cloudflare ตอบ 403
- ไม่ใช้ Paid API หรือ API key ของระบบตามข้อกำหนดไม่มีค่าใช้จ่ายเพิ่ม
- ดังนั้น Phase 0 รอบนี้มี Search visibility baseline และ Prompt set ครบ แต่ยังไม่มีตัวเลข AI Mention/Citation ที่ทำซ้ำได้ครบทุกแพลตฟอร์ม
- วิธีฟรีที่เหมาะสมคือให้ผู้ใช้งานที่ Login อยู่รันทดสอบ Prompt ชุด Priority และบันทึกคำตอบ หรือทำ Manual sampling เป็นรอบโดยไม่พยายาม Bypass ระบบป้องกัน Bot

## 7. Content gaps ที่เห็นชัด

1. Fiber Disc vs Flap Disc
2. Flap Disc หลังอ่อน vs หลังแข็ง
3. กระดาษทรายน้ำ vs แห้ง
4. PSA vs Hook and Loop
5. Aluminum Oxide vs Zirconia vs Ceramic
6. ตารางเลือก Grit ตามวัสดุและขั้นตอนงาน
7. คู่มือขัดสแตนเลสไม่ให้ไหม้
8. คู่มือทำ Hairline ให้สม่ำเสมอ
9. สาเหตุกระดาษทรายตัน/หลุด/ขาดเร็ว
10. Safety: Max RPM, การเก็บรักษา และการตรวจแผ่นก่อนใช้
11. วิธีคำนวณต้นทุน Abrasive ต่อชิ้นงาน
12. แบบฟอร์มข้อมูลที่ลูกค้าต้องแจ้งเพื่อเลือกสินค้า

## 8. Top 20 proposed actions

รายการนี้ยังไม่อนุมัติให้แก้ เป็น Backlog สำหรับ Gate ก่อน Phase 1

| Priority | Action | Phase |
|---|---|---|
| P0-01 | แก้ SKU normalization และ URL/Sitemap ของ `2020003264` | 1 |
| P0-02 | ทำ URL ownership matrix สำหรับสองโดเมน โดยเริ่มจาก 7 รุ่นที่ซ้ำ | 1 |
| P0-03 | ตรวจและรักษาหน้าที่มี Search equity ก่อน Redirect/Canonical | 1 |
| P0-04 | ติดตั้ง Measurement บน `jnac.online` ด้วยทรัพยากรเดิม/ฟรี | 1 |
| P0-05 | ลดการ Render สินค้า 515 รายการพร้อมกันด้วย Pagination/Load more | 1 |
| P0-06 | ลด LCP หน้า Home, Category และ Product | 1 |
| P0-07 | เปลี่ยน Branding จาก `JNAC by CoreBiz` เป็น J NAC/JNAC | 1 |
| P0-08 | ตรวจ Claim อัตโนมัติ เช่น มาตรฐาน ความทนทาน สต็อก และผู้เชี่ยวชาญ | 1 |
| P0-09 | แก้ Link LINE เดิมบน `jnac.co.th` ให้ใช้ `https://line.me/R/ti/p/@jnac` | 1 |
| P0-10 | ทำ `robots.txt` ของ `jnac.co.th` ให้มี Policy และ Sitemap ชัดเจน | 1 |
| P1-11 | เพิ่ม WebSite/Organization entity graph ที่สอดคล้องกัน | 1 |
| P1-12 | เพิ่ม Article/Product/Breadcrumb/FAQ Schema ให้หน้า `jnac.co.th` ที่รักษาไว้ | 1 |
| P1-13 | เพิ่มผู้เขียน/ผู้ตรวจสอบที่เป็นบุคคลจริงและหน้า Profile | 1 |
| P1-14 | เพิ่ม datePublished/dateModified เมื่อมีข้อมูลจริง | 1 |
| P1-15 | ปรับ H1/Heading ของหน้าแรก `jnac.co.th` | 1 |
| P1-16 | เพิ่ม Mobile navigation บน `jnac.online` โดยรักษา Cart/Account | 1 |
| P1-17 | สร้าง Internal links ระหว่าง Knowledge/Comparison/Product family/SKU | 2 |
| P1-18 | สร้าง Comparison pages 5 หัวข้อแรกจาก Content gap | 2 |
| P2-19 | สร้าง Grit/material selector จากข้อมูลที่ผู้เชี่ยวชาญตรวจแล้ว | 2 |
| P2-20 | รัน Prompt sampling ซ้ำทุกเดือนและบันทึก Mention/Citation/Lead | 3 |

## 9. Gate เพื่อจบ Phase 0

- [x] ตรวจคำสั่งโปรเจกต์และ Dirty worktree
- [x] ตรวจ Sitemap/Robots/URL inventory ของสองโดเมน
- [x] ตรวจ Mobile UX และ Lighthouse baseline
- [x] ตรวจ Structured Data และ Metadata ตัวอย่าง
- [x] สร้าง Prompt Library 80 คำถาม
- [x] ระบุ Search-visible competitor candidates
- [x] ระบุ Domain overlap และ Content gap
- [x] จัด Top 20 backlog
- [ ] ยืนยันสิทธิ์เข้าถึง Google Search Console/GA4
- [ ] เก็บ AI Mention/Citation จากบัญชีที่ Login โดยไม่ใช้ Paid API
- [ ] Boss jack ตรวจและอนุมัติขอบเขต Phase 1

Phase 0 สามารถปิดเชิง Technical audit ได้ แต่ก่อนเริ่ม Phase 1 ควรตัดสินใจสองเรื่อง: (1) จะใช้ Measurement property ใดกับ `jnac.online` และ (2) รับรองบทบาท `jnac.co.th = knowledge/family authority`, `jnac.online = product/SKU/conversion` เป็นหลักการเบื้องต้นหรือไม่
