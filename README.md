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

ข้อมูลจะถูกเก็บในตาราง `buy_items` โดยใช้ `day_key` ของวันปัจจุบัน และ realtime subscription จะ sync รายการซื้อระหว่างมือถือ แท็บเล็ต และ PC ที่เปิดวันเดียวกัน

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
