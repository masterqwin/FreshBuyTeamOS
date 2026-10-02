-- FreshBuy Team OS atomic global replace/clear RPCs
-- Owner/admin SQL Editor only. Review before running.
-- Run after production cleanup validation and before deploying app code that calls these RPCs.
-- Source of truth remains public.buy_items only; no batch table, batch_id, or day-based runtime logic.

create or replace function public.freshbuy_replace_all_items(items jsonb)
returns table(success boolean, inserted_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload_count integer;
  invalid_count integer;
  actual_inserted integer;
begin
  perform pg_advisory_xact_lock(hashtext('freshbuy_global_buy_items'));

  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'freshbuy_replace_all_items expected a JSON array payload';
  end if;

  payload_count := jsonb_array_length(items);

  select count(*)
  into invalid_count
  from jsonb_to_recordset(items) as payload(
    id uuid,
    name text,
    quantity text,
    unit text,
    max_price text,
    note text,
    status text,
    buyer_name text,
    bought_at timestamptz,
    actual_price text,
    checked_at timestamptz,
    issue_note text,
    vehicle_status text,
    day_key text
  )
  where payload.id is null
     or nullif(btrim(payload.name), '') is null
     or payload.quantity is null
     or payload.unit is null
     or nullif(btrim(payload.status), '') is null
     or nullif(btrim(payload.day_key), '') is null;

  if invalid_count <> 0 then
    raise exception 'freshbuy_replace_all_items payload has % invalid rows', invalid_count;
  end if;

  delete from public.buy_items
  where id is not null;

  insert into public.buy_items (
    id,
    name,
    quantity,
    unit,
    max_price,
    note,
    status,
    buyer_name,
    bought_at,
    actual_price,
    checked_at,
    issue_note,
    vehicle_status,
    day_key
  )
  select
    payload.id,
    payload.name,
    payload.quantity,
    payload.unit,
    payload.max_price,
    payload.note,
    payload.status,
    payload.buyer_name,
    payload.bought_at,
    payload.actual_price,
    payload.checked_at,
    payload.issue_note,
    coalesce(nullif(payload.vehicle_status, ''), 'unchecked'),
    payload.day_key
  from jsonb_to_recordset(items) as payload(
    id uuid,
    name text,
    quantity text,
    unit text,
    max_price text,
    note text,
    status text,
    buyer_name text,
    bought_at timestamptz,
    actual_price text,
    checked_at timestamptz,
    issue_note text,
    vehicle_status text,
    day_key text
  );

  get diagnostics actual_inserted = row_count;

  if actual_inserted <> payload_count then
    raise exception 'freshbuy_replace_all_items inserted % rows, expected %', actual_inserted, payload_count;
  end if;

  success := true;
  inserted_count := actual_inserted;
  return next;
end;
$$;

create or replace function public.freshbuy_clear_all_items()
returns table(success boolean, deleted_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  before_count integer;
  remaining_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('freshbuy_global_buy_items'));

  select count(*)
  into before_count
  from public.buy_items;

  delete from public.buy_items
  where id is not null;

  select count(*)
  into remaining_count
  from public.buy_items;

  if remaining_count <> 0 then
    raise exception 'freshbuy_clear_all_items expected 0 remaining rows, got %', remaining_count;
  end if;

  success := true;
  deleted_count := before_count;
  return next;
end;
$$;

grant execute on function public.freshbuy_replace_all_items(jsonb) to anon;
grant execute on function public.freshbuy_clear_all_items() to anon;
