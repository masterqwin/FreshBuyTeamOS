# FreshBuy Team OS - Updated Handoff

เอกสารนี้คือ handoff ล่าสุดสำหรับกลับมาพัฒนา FreshBuy Team OS ต่อในอนาคต หากห้องแชทเดิมถูกลบหรือ context หาย ให้เริ่มอ่านไฟล์นี้ก่อนเสมอ

## Project

- Project root: `D:\SBP\projects\FreshBuyTeamOS`
- Production app: FreshBuy Team OS V1
- Stack: Next.js + TypeScript + Tailwind CSS
- UI language: Thai
- Primary users: ทีมซื้อผักสด 3 ผู้ซื้อ + คนเช็คของ
- Primary devices: phone, tablet, PC

## Commands

```powershell
Set-Location D:\SBP\projects\FreshBuyTeamOS
npm install
npm run dev
npm run typecheck
npm run build
```

## Architecture (LOCKED)

FreshBuy Team OS V1 now uses:

```text
Single Global Buy List
```

Source of truth:

```text
Supabase table: buy_items
```

The app always loads the entire `buy_items` table.

Realtime subscribes to the entire `buy_items` table.

There is NO runtime concept of:

- `activeDayKey`
- current batch
- `batch_id`
- `freshbuy_batches`
- workspace/session
- day-based current list selection

`day_key` remains only for legacy compatibility and old records. It must not be used to select the current working list.

The system must never automatically create a new day, switch batches, or choose records based on dates.

The Owner alone decides when a new working cycle begins.

## Daily Workflow (LOCKED)

Owner workflow is intentionally simple.

Every work cycle:

1. Optional: Backup CSV.
2. Press `ล้างข้อมูลวันนี้`.
3. This clears ALL rows from `buy_items`.
4. Open `เช็คสินค้า` and press `เริ่มเช็คสินค้าที่ต้องซื้อใหม่`.
5. Enter quantity/unit only for products that must be purchased.
6. Press `ส่งรายการไป ต้องซื้อวันนี้`.
7. Buy items.
8. Check vehicle.
9. Finish.

Rules:

- The system MUST NEVER create a new day automatically.
- The system MUST NEVER switch batches.
- The system MUST NEVER choose records based on dates.
- The Owner manually controls clear/import timing.

## Core Pages

Navigation order:

1. `เช็คสินค้า`
2. `ต้องซื้อวันนี้`
3. `ซื้อแล้ว`
4. `ไม่มีของ`
5. `เช็คขึ้นรถ`
6. `ประวัติวันนี้`

## Data Model Notes

Important item fields:

- `id`
- `name`
- `quantity` as text/string, because values like `1/2` must be preserved
- `unit`
- `maxPrice` / `max_price`
- `note`
- `status`: `pending | bought | checked | missing | unavailable | expensive | cancelled`
- `buyerName` / `buyer_name`
- `boughtAt` / `bought_at`
- `actualPrice` / `actual_price`
- `checkedAt` / `checked_at`
- `issueNote` / `issue_note`
- `vehicleStatus` / `vehicle_status`: `unchecked | loaded | incomplete`
- `dayKey` / `day_key` for legacy compatibility only

Vehicle status display:

- `unchecked` = `ยังไม่ได้เช็คขึ้นรถ`
- `loaded` = `ครบ`
- `incomplete` = `ไม่ครบ`

## Persistence And Realtime

Production persistence is Supabase-first.

Required public env:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

If Supabase env is missing in a local/dev environment, the app may fall back to localStorage. In production, Supabase is the source of truth.

Current rules:

- Load all rows from `buy_items`.
- Subscribe realtime to all changes on `buy_items`.
- Do not filter fetch/realtime by `day_key`.
- Do not use batch tables.
- Do not use localStorage as online source of truth.

## Production SQL

Production now requires:

```text
supabase/atomic_global_replace.sql
```

Product Master additionally requires owner/admin review and manual execution of:

```text
supabase/product_master.sql
```

This creates `public.product_master`, its updated-at trigger, fixed category
constraint, active-name uniqueness, anon select/insert/update policies, and
Realtime publication entry. It does not modify `public.buy_items`.

This installs the official RPC API used by the application:

- `freshbuy_replace_all_items(items jsonb)`
- `freshbuy_clear_all_items()`

These RPCs are the official database API for replace-all and clear-all behavior.

Required RPC properties:

- Use `pg_advisory_xact_lock(hashtext('freshbuy_global_buy_items'))`.
- Replace and clear use the same lock key.
- Use `SECURITY INVOKER`.
- Validate replace payload before deleting old rows.
- If insert fails, the transaction rolls back.
- `inserted_count` must match payload count.
- Clear verifies `remaining_count = 0`.
- Grant execute to the app role.
- No service role key in frontend.
- No batch logic.
- No day-based selection logic.

## Hotfix History

### 2026-07-15 - RPC DELETE Requires WHERE Clause

Problem:

Supabase returned:

```text
DELETE requires a WHERE clause
code 21000
```

Root cause:

The RPC attempted:

```sql
DELETE FROM public.buy_items;
```

The production database policy rejected DELETE without a WHERE clause.

Resolution:

Changed both RPC DELETE statements to:

```sql
DELETE FROM public.buy_items
WHERE id IS NOT NULL;
```

Applied to:

- `freshbuy_replace_all_items(items jsonb)`
- `freshbuy_clear_all_items()`

Why this is equivalent:

- `id` is primary key / not null.
- `WHERE id IS NOT NULL` still targets all rows.
- It satisfies the Supabase/PostgREST safety requirement.

Verified:

- `npm run typecheck` = PASS
- `npm run build` = PASS

## UAT Status

Today's UAT completed.

Verified:

- Multi-device sync
- Global list architecture
- Clear All
- Replace All
- Realtime
- Supabase connection
- RPC rollback behavior: failed replace did not leave partial rows
- Production recovered to Supabase / Realtime Connected after refresh

Known remaining work:

- Continue real-world usage.
- Fix only issues discovered during actual daily operation.
- No architecture rewrite unless Owner approves.

## Important Workflow Behavior

### Product Check Page

- `เช็คสินค้า` is the first and normal daily owner workflow.
- Active reusable products come from `public.product_master`.
- Product Master is permanent and independent from the global `buy_items` list.
- Blank/zero quantity means not selected; entering a quantity selects the item.
- Unit defaults from Product Master but remains editable for the current list.
- Sending appends new `pending` rows through the existing `buy_items` path.
- Sending never replaces or deletes existing global-list rows.
- Rapid double submission is guarded in both the page and Home state.
- Product removal is soft archive (`active=false`) and never changes history.
- Categories are fixed for Phase 1: `ผักใบ`, `ผักผล`, `ผักเมืองหนาว`,
  `ผักแพ๊คและเห็ด`, `เครื่องเทศ`, `อื่นๆ`.
- Product Master has its own Realtime subscription and localStorage fallback.

### Legacy Import Page

- The Excel/Google Sheet parser is no longer the normal daily workflow.
- It remains available in a collapsed owner-only legacy tools section.
- Paste Google Sheet / Excel rows.
- Support tab-separated or comma-separated rows.
- Expected columns: `name, quantity, unit, maxPrice, note`.
- Fractional quantities like `1/2` must remain `1/2`, not convert to `0`.
- `สร้างรายการซื้อวันนี้` replaces the entire global list through `freshbuy_replace_all_items`.
- `เพิ่มรายการวันนี้` appends parsed items to the current global list.
- `ล้างข้อมูลวันนี้` clears all rows through `freshbuy_clear_all_items` after confirmation.
- `Backup วันนี้เป็น CSV` exports all current rows without clearing data.

CSV backup:

- Filename: `freshbuy_YYYY-MM-DD.csv`
- UTF-8 with BOM for Excel Thai compatibility.
- Includes item status, buyer, price, vehicle status, and note fields.

### Pending Page

Pending item cards stay compact:

- Product name
- Quantity + unit
- Button: `ซื้อแล้ว`
- Button: `ไม่มีของ`

`ซื้อแล้ว` opens the price popup and does not mark bought until confirmation.

The price popup uses app keypad only and must not open the native phone keyboard.

`ไม่มีของ` works immediately and must not enter bought/check queue.

Thai search/filter uses `getThaiInitialKey(name: string)` and supports leading vowels.

### Bought Page

Bought page is the permanent tracking page.

Rows show:

- Product
- Quantity
- Actual price
- Buyer
- Purchase time
- Vehicle status
- `แก้ราคา`
- `กลับไปรอซื้อ`

Visible purchase time is `HH:mm` only. Stored timestamps must remain full values.

Filter bar includes:

- `ยอดเงินรวมทั้งหมด`
- `ครบ`
- `ไม่ครบ`
- `ยังไม่ได้เช็คขึ้นรถ`

### No Stock Page

- Shows `unavailable` items only.
- Uses compact responsive rows/cards.
- `กลับไปรอซื้อ` returns item to pending.

### Check Page

Check page is a temporary working queue.

- Shows bought items with `vehicleStatus=unchecked`.
- `ครบ` sets `vehicleStatus=loaded`.
- `ของไม่ครบ` sets `vehicleStatus=incomplete`.
- Processed items disappear from Check page.
- Bought page remains the permanent tracking page.

### History / Print

History groups:

- `รอซื้อ`
- `ซื้อแล้ว`
- `เช็คครบ`
- `ไม่มีของ`
- `ของไม่ครบ`
- `ยกเลิก`

Print view remains print-only, compact, A4 portrait, with 2 readable tables per page.

## Owner Lock

The Import page is owner-locked.

Server-only env:

```env
IMPORT_PAGE_PIN=
```

Rules:

- Never use `NEXT_PUBLIC_IMPORT_PAGE_PIN`.
- Never hardcode the real PIN in client React code.
- Never print or log the real PIN.
- PIN verification is server-side through `app/api/import-pin/route.ts`.

Unlock marker:

```text
fresh-buy-import-unlocked-v1 = unlocked
```

The marker stores only unlock state, not the PIN.

## Responsive Architecture

Current responsive behavior is viewport-driven.

Ranges:

- `< 560px`: compact mobile layout
- `>= 560px`: compact horizontal / medium layout
- `>= 768px`: wider tablet layout
- `>= 1280px`: desktop-like layout

Rules:

- Do not use user-agent/device-name detection.
- Do not hardcode Huawei/iPad/Android-specific layout logic.
- Prefer CSS media queries, Grid, Flexbox, `minmax()`, `min-width: 0`, and fluid sizing.
- Rotation must reflow from actual viewport size.
- Avoid page-level horizontal scrolling.

## QA Rule

After every implementation/fix, run:

```powershell
npm run typecheck
npm run build
```

If `npm run lint` opens interactive setup, report it honestly and do not create config randomly.

## Future Codex Start Instruction

When continuing this project, start with:

```text
Work on the existing project only:

D:\SBP\projects\FreshBuyTeamOS

First read FRESHBUY_HANDOFF_UPDATED.md completely and treat it as the current project source of truth.

Then inspect git status, git diff, app/page.tsx, app/globals.css, lib/supabaseFreshBuy.ts, and supabase/atomic_global_replace.sql before changing anything.

Preserve Single Global Buy List architecture.

Do not reintroduce activeDayKey, current batch, batch_id, freshbuy_batches, workspace/session, or day-based current-list selection.

Do not deploy unless explicitly instructed.

Run npm run typecheck and npm run build after changes.
```

## CHANGELOG

### 2026-10-02

1. Added the Phase 1 Product Master architecture in a separate `product_master` table.
2. Added the non-destructive manual migration `supabase/product_master.sql`.
3. Replaced the first navigation item with `เช็คสินค้า`.
4. Added active-product loading, category filters, search, quantity/unit checking,
   guarded append to `ต้องซื้อวันนี้`, add/edit, and soft archive.
5. Preserved the global `buy_items` buyer/realtime/history/vehicle workflow.
6. Kept the former Excel import UI in a collapsed owner-only legacy section.

### 2026-07-15

Completed fixes in chronological order:

1. Confirmed production architecture is Single Global Buy List using Supabase `buy_items`.
2. Removed runtime current-day/current-batch architecture from the handoff source of truth.
3. Documented locked owner workflow: Backup CSV, clear all rows, import, create list, buy, check vehicle, finish.
4. Documented `atomic_global_replace.sql` as required production SQL.
5. Documented official RPC API:
   - `freshbuy_replace_all_items(items jsonb)`
   - `freshbuy_clear_all_items()`
6. Production cleanup and RPC installation were prepared for owner/admin SQL execution.
7. UAT verified multi-device sync, global list behavior, clear all, replace all, realtime, and Supabase connection.
8. Production error occurred: `DELETE requires a WHERE clause` / code `21000`.
9. Root cause identified: RPC used `DELETE FROM public.buy_items;`.
10. Hotfix applied to RPC SQL: changed DELETE to `DELETE FROM public.buy_items WHERE id IS NOT NULL;`.
11. Hotfix applied to both replace and clear RPC functions.
12. Verified hotfix locally:
    - `npm run typecheck` = PASS
    - `npm run build` = PASS
13. Current known work is real-world usage only; fix future issues as discovered during daily operation.
