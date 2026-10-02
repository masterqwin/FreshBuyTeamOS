# FreshBuy Team OS V1

FreshBuy Team OS เป็นเว็บแอป Next.js + TypeScript + Tailwind สำหรับทีมซื้อผักสดขนาดเล็ก 3 คน ใช้แท็บเล็ตเป็นหลัก และเก็บข้อมูลใน browser `localStorage` โดยไม่ต้องใช้ API ภายนอก

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

เปิดเว็บที่ `http://localhost:3000`

## Supabase Setup

FreshBuy Team OS V1.1 ใช้ Supabase สำหรับ online multi-device realtime sync และจะ fallback ไปใช้ `localStorage` อัตโนมัติถ้าไม่ได้ตั้งค่า env

1. สร้าง Supabase project
2. เปิด SQL Editor แล้วรันไฟล์ `supabase/schema.sql`
3. ไปที่ Project Settings > API แล้วคัดลอกค่า Project URL และ anon public key
4. สร้างไฟล์ `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

5. รันระบบ

```bash
npm install
npm run dev
```

### Product Master / เช็คสินค้า

Phase 1 adds a permanent `product_master` table that is separate from the global
`buy_items` working list. Review and run this file in Supabase SQL Editor before
deploying the Product Check UI:

```text
supabase/product_master.sql
```

The migration is non-destructive: it does not update or delete `buy_items`.
Removing a master product sets `active=false`, so old shopping history remains
unchanged. The six initial categories are fixed to:

```text
ผักใบ, ผักผล, ผักเมืองหนาว, ผักแพ๊คและเห็ด, เครื่องเทศ, อื่นๆ
```

The normal workflow is now `เช็คสินค้า` → enter quantity/select unit → send one
product row. Each send appends one pending `buy_items` row and never replaces the
current list. Active Product Master products are hidden when a normalized product
name already exists anywhere in the current global `buy_items` list, regardless
of purchase or vehicle status. Name matching uses Unicode NFKC normalization,
trimmed/collapsed whitespace, and Thai lowercase comparison; Product Master does
not yet have a persistent product id link in `buy_items`, so distinct products
that normalize to the same name cannot be distinguished. Starting a new working
cycle uses the existing atomic global clear RPC and never changes Product Master.
The previous Excel parser remains available inside the collapsed owner-only
legacy tools section.

### โทร/LINE สั่ง

Product Master supports `purchase_method = walk | phone`. Existing products
default to `walk`; phone products require a free-form `supplier_name`. Run the
following non-destructive migration manually in Supabase SQL Editor before using
this application version:

```text
supabase/phone_order_fulfillment.sql
```

Phone/LINE products are written to the separate realtime table
`phone_order_items`, never to `buy_items`. The `รายการโทรสั่ง` page groups the
current rows by supplier, copies one LINE-ready message per supplier, and allows
an individual row to be returned to Product Check. The existing
`freshbuy_clear_all_items()` RPC is replaced by the migration so starting a new
working cycle clears both operational tables atomically while preserving Product
Master.

ข้อมูลออนไลน์ V1.3 ใช้ Single Global Buy List จาก Supabase table `buy_items` เพียงตารางเดียว ทุกอุปกรณ์อ่านและแก้รายการชุดเดียวกันจากทั้งตารางโดยไม่ filter ด้วย `day_key`, `activeDayKey`, `batch_id`, current date หรือ localStorage key

คอลัมน์ `day_key` เดิมยังอยู่เพื่อ compatibility/backup แต่ application logic ไม่ใช้เลือกชุดข้อมูลที่แสดงหรือแก้ไขแล้ว

### Production Cleanup Review

production ปัจจุบันอาจมี rows หลาย `day_key` อยู่ใน `buy_items` ต้อง backup ก่อนและค่อยรัน cleanup SQL ที่ owner review แล้วเท่านั้น:

```sql
select day_key, status, count(*) as item_count, max(updated_at) as latest_update
from public.buy_items
group by day_key, status
order by latest_update desc nulls last, day_key desc, status;
```

owner-selected live data:

- `day_key = '2026-07-12'`
- expected: total 111, bought 105, unavailable 6, loaded 76, unchecked 35

backup candidate:

- `day_key = '2026-07-14'`
- expected: total 111, pending 111

cleanup SQL ต้องลบ rows อื่นออกจาก live `buy_items` และคงไว้เฉพาะ `day_key = '2026-07-12'` หลังจาก backup แล้วเท่านั้น ห้ามใช้ SQL Current Batch เดิม และห้ามสร้าง `freshbuy_batches` หรือ `batch_id`

### Atomic Replace / Clear RPC

หลัง cleanup production และ validate ว่าเหลือ live rows ถูกต้องแล้ว ให้ owner/admin review และรัน:

```text
supabase/atomic_global_replace.sql
```

ไฟล์นี้สร้าง RPC:

- `public.freshbuy_replace_all_items(items jsonb)` returns `success`, `inserted_count`
- `public.freshbuy_clear_all_items()` returns `success`, `deleted_count`

ทั้งสอง function ใช้ `pg_advisory_xact_lock(hashtext('freshbuy_global_buy_items'))` เพื่อกัน replace/clear ชนกันจากหลายเครื่อง และใช้ `SECURITY INVOKER` ไม่ต้องใช้ service role key ใน frontend

RPC replace รองรับ column ที่ระบบใช้จริง:

```text
id, name, quantity, unit, max_price, note, status, buyer_name,
bought_at, actual_price, checked_at, issue_note, vehicle_status, day_key
```

ลำดับ production ที่แนะนำ:

1. ตรวจ backup files
2. owner review และรัน `production_single_global_list_owner_selected_READY_TO_REVIEW.sql`
3. validate production เหลือ 111 rows ตาม expected counts
4. owner review และรัน `supabase/atomic_global_replace.sql`
5. ตรวจว่า RPC execute ได้ด้วย anon role
6. deploy application
7. UAT Desktop/Mobile/Tablet

## Vercel Deploy

1. Push project ขึ้น GitHub
2. Import project ใน Vercel
3. ตั้ง Environment Variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

4. Deploy

หลัง deploy แล้ว ผู้ซื้อหลายเครื่องสามารถเปิด URL เดียวกันและเห็นรายการ sync กันแบบ realtime

## Add to Home Screen

แอปมี PWA manifest แล้ว ไม่ต้องใช้ App Store หรือ Play Store

### iPhone / iPad

1. เปิดเว็บด้วย Safari
2. กดปุ่ม Share
3. เลือก Add to Home Screen
4. กด Add

### Android

1. เปิดเว็บด้วย Chrome
2. กดเมนู 3 จุด
3. เลือก Add to Home screen หรือ Install app
4. กด Add / Install

## Manual Daily CSV Backup

ก่อนกด `ล้างข้อมูลวันนี้` แนะนำให้ไปที่หน้า `นำเข้ารายการ` แล้วกด `Backup วันนี้เป็น CSV`

ระบบจะดาวน์โหลดไฟล์ชื่อ:

```text
freshbuy_YYYY-MM-DD.csv
```

แนะนำให้เก็บไฟล์ไว้ใน Google Drive ตามโครงสร้าง:

```text
FreshBuy_Backup/YYYY/MM/freshbuy_YYYY-MM-DD.csv
```

ตัวอย่าง:

```text
FreshBuy_Backup/2026/07/freshbuy_2026-07-09.csv
```

## Testing Checklist

- เลือกผู้ใช้งานได้: `ผู้ซื้อ 1`, `ผู้ซื้อ 2`, `ผู้ซื้อ 3`, `คนเช็คของ`
- วางข้อมูลจาก Google Sheet หรือ Excel แบบ tab-separated หรือ comma-separated
- กด `สร้างรายการซื้อวันนี้` แล้วรายการไปอยู่ที่แท็บ `ต้องซื้อวันนี้`
- กด `ซื้อแล้ว` แล้วใส่ราคาจริง รายการต้องย้ายไปแท็บ `ซื้อแล้ว`
- ถ้าราคาจริงสูงกว่าเพดาน ระบบต้องเตือนและบันทึกเป็น `แพงเกินไป` ได้
- กด `ไม่มีของ` หรือ `แพงเกินไป` จากรายการรอซื้อได้
- แท็บ `ซื้อแล้ว` แก้ไขราคาจริง และย้ายกลับไป `รอซื้อ` ได้
- แท็บ `เช็คขึ้นรถ` กด `ครบ`, `ของไม่ครบ`, `ไม่มีของ`, `แพงเกินไป` ได้
- แท็บ `ประวัติวันนี้` แสดงรายการแยกตามสถานะ
- กด `พิมพ์รายการซื้อ` แล้วหน้าพิมพ์แสดงรายการรอซื้อและรายการมีปัญหาชัดเจน
- รีเฟรชหน้าแล้วข้อมูลยังอยู่จาก `localStorage`
- ปุ่มหลักมีเสียง beep สั้นจาก Web Audio API

## Sample Import Data

```text
ผักกาดขาว	5	กก.	25	เอาสวย ไม่ช้ำ
แตงกวา	10	กก.	30
พริกแดง	2	กก.	90
```
