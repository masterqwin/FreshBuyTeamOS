-- FreshBuy Team OS production cleanup for Single Global Buy List
-- Owner-selected live data: day_key = '2026-07-12'
-- Backup candidate preserved in exported backup files: day_key = '2026-07-14'
--
-- OWNER/ADMIN SQL EDITOR ONLY.
-- Run this script exactly once, only after production backup files have been verified.
-- Validate the result before deploying application code that reads the global buy_items list.
-- If any guard fails, a RAISE EXCEPTION aborts the transaction and rolls back all deletes.
-- This script does not ALTER schema, does not DROP columns, and does not create batch objects.

begin;

do $$
declare
  all_total integer;
  selected_total integer;
  selected_bought integer;
  selected_unavailable integer;
  selected_pending integer;
  selected_loaded integer;
  selected_unchecked integer;
  backup_total integer;
  backup_pending integer;
begin
  select count(*)
  into all_total
  from public.buy_items;

  if all_total <> 485 then
    raise exception 'Preflight total buy_items mismatch. Expected 485, got %', all_total;
  end if;

  select
    count(*),
    count(*) filter (where status = 'bought'),
    count(*) filter (where status = 'unavailable'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where vehicle_status = 'loaded'),
    count(*) filter (where coalesce(vehicle_status, 'unchecked') = 'unchecked')
  into selected_total, selected_bought, selected_unavailable, selected_pending, selected_loaded, selected_unchecked
  from public.buy_items
  where day_key = '2026-07-12';

  if selected_total <> 111
     or selected_bought <> 105
     or selected_unavailable <> 6
     or selected_pending <> 0
     or selected_loaded <> 76
     or selected_unchecked <> 35 then
    raise exception 'Selected day_key 2026-07-12 mismatch: total %, bought %, unavailable %, pending %, loaded %, unchecked %',
      selected_total, selected_bought, selected_unavailable, selected_pending, selected_loaded, selected_unchecked;
  end if;

  select
    count(*),
    count(*) filter (where status = 'pending')
  into backup_total, backup_pending
  from public.buy_items
  where day_key = '2026-07-14';

  if backup_total <> 111 or backup_pending <> 111 then
    raise exception 'Backup day_key 2026-07-14 mismatch before cleanup: total %, pending %',
      backup_total, backup_pending;
  end if;
end;
$$;

delete from public.buy_items
where day_key is distinct from '2026-07-12';

do $$
declare
  final_total integer;
  final_bought integer;
  final_unavailable integer;
  final_pending integer;
  final_loaded integer;
  final_unchecked integer;
  other_day_count integer;
  duplicate_ids integer;
begin
  select
    count(*),
    count(*) filter (where status = 'bought'),
    count(*) filter (where status = 'unavailable'),
    count(*) filter (where status = 'pending'),
    count(*) filter (where vehicle_status = 'loaded'),
    count(*) filter (where coalesce(vehicle_status, 'unchecked') = 'unchecked')
  into final_total, final_bought, final_unavailable, final_pending, final_loaded, final_unchecked
  from public.buy_items;

  if final_total <> 111
     or final_bought <> 105
     or final_unavailable <> 6
     or final_pending <> 0
     or final_loaded <> 76
     or final_unchecked <> 35 then
    raise exception 'Post-cleanup mismatch: total %, bought %, unavailable %, pending %, loaded %, unchecked %',
      final_total, final_bought, final_unavailable, final_pending, final_loaded, final_unchecked;
  end if;

  select count(*)
  into other_day_count
  from public.buy_items
  where day_key is distinct from '2026-07-12';

  if other_day_count <> 0 then
    raise exception 'Post-cleanup guard failed: % rows still have another day_key', other_day_count;
  end if;

  select count(*) - count(distinct id)
  into duplicate_ids
  from public.buy_items;

  if duplicate_ids <> 0 then
    raise exception 'Post-cleanup duplicate id count is %', duplicate_ids;
  end if;
end;
$$;

select
  count(*) as total,
  count(*) filter (where status = 'bought') as bought,
  count(*) filter (where status = 'unavailable') as unavailable,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where vehicle_status = 'loaded') as loaded,
  count(*) filter (where coalesce(vehicle_status, 'unchecked') = 'unchecked') as unchecked,
  min(created_at) as earliest_created_at,
  max(created_at) as latest_created_at,
  max(updated_at) as latest_updated_at
from public.buy_items;

commit;
