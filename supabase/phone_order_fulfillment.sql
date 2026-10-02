-- FreshBuy Team OS: purchase methods and phone/LINE order workflow
-- OWNER/ADMIN SQL EDITOR ONLY. Run once before deploying the matching application code.
-- Non-destructive: preserves product_master and buy_items data.

begin;

alter table public.product_master
  add column if not exists purchase_method text,
  add column if not exists supplier_name text;

update public.product_master
set purchase_method = 'walk'
where purchase_method is null;

alter table public.product_master
  alter column purchase_method set default 'walk',
  alter column purchase_method set not null;

alter table public.product_master
  drop constraint if exists product_master_purchase_method_allowed,
  drop constraint if exists product_master_phone_supplier_required,
  drop constraint if exists product_master_walk_supplier_empty;

alter table public.product_master
  add constraint product_master_purchase_method_allowed
    check (purchase_method in ('walk', 'phone')),
  add constraint product_master_phone_supplier_required
    check (purchase_method <> 'phone' or nullif(btrim(supplier_name), '') is not null),
  add constraint product_master_walk_supplier_empty
    check (purchase_method <> 'walk' or supplier_name is null);

create table if not exists public.phone_order_items (
  id uuid primary key default gen_random_uuid(),
  product_master_id uuid null references public.product_master(id) on delete set null,
  product_name text not null,
  quantity text not null,
  unit text not null,
  supplier_name text not null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_order_product_name_not_blank check (nullif(btrim(product_name), '') is not null),
  constraint phone_order_quantity_not_blank check (nullif(btrim(quantity), '') is not null),
  constraint phone_order_unit_not_blank check (nullif(btrim(unit), '') is not null),
  constraint phone_order_supplier_not_blank check (nullif(btrim(supplier_name), '') is not null)
);

create index if not exists phone_order_items_supplier_created_idx
  on public.phone_order_items (supplier_name, created_at, id);

drop trigger if exists phone_order_items_set_updated_at on public.phone_order_items;
create trigger phone_order_items_set_updated_at
before update on public.phone_order_items
for each row
execute function public.set_product_master_updated_at();

alter table public.phone_order_items enable row level security;

drop policy if exists "allow anon read phone_order_items" on public.phone_order_items;
create policy "allow anon read phone_order_items"
on public.phone_order_items for select
to anon
using (true);

drop policy if exists "allow anon insert phone_order_items" on public.phone_order_items;
create policy "allow anon insert phone_order_items"
on public.phone_order_items for insert
to anon
with check (true);

drop policy if exists "allow anon delete phone_order_items" on public.phone_order_items;
create policy "allow anon delete phone_order_items"
on public.phone_order_items for delete
to anon
using (true);

grant select, insert, delete on public.phone_order_items to anon;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'phone_order_items'
  ) then
    alter publication supabase_realtime add table public.phone_order_items;
  end if;
end;
$$;

create or replace function public.freshbuy_clear_all_items()
returns table(success boolean, deleted_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  buy_count integer;
  phone_count integer;
  remaining_buy_count integer;
  remaining_phone_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('freshbuy_global_buy_items'));

  select count(*) into buy_count from public.buy_items;
  select count(*) into phone_count from public.phone_order_items;

  delete from public.buy_items where id is not null;
  delete from public.phone_order_items where id is not null;

  select count(*) into remaining_buy_count from public.buy_items;
  select count(*) into remaining_phone_count from public.phone_order_items;

  if remaining_buy_count <> 0 or remaining_phone_count <> 0 then
    raise exception 'freshbuy_clear_all_items expected empty lists, got buy_items %, phone_order_items %',
      remaining_buy_count, remaining_phone_count;
  end if;

  success := true;
  deleted_count := buy_count + phone_count;
  return next;
end;
$$;

grant execute on function public.freshbuy_clear_all_items() to anon;

commit;

-- Validation only (does not mutate data):
select purchase_method, count(*)
from public.product_master
group by purchase_method
order by purchase_method;

select count(*) as phone_order_item_count
from public.phone_order_items;
