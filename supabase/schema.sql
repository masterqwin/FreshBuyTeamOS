create extension if not exists "pgcrypto";

create table if not exists public.buy_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity text not null,
  unit text not null,
  max_price text null,
  note text null,
  status text not null default 'pending',
  buyer_name text null,
  bought_at timestamptz null,
  actual_price text null,
  checked_at timestamptz null,
  issue_note text null,
  vehicle_status text not null default 'unchecked',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  day_key text not null
);

create index if not exists buy_items_day_key_created_at_idx
  on public.buy_items (day_key, created_at);

create or replace function public.set_buy_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists buy_items_set_updated_at on public.buy_items;
create trigger buy_items_set_updated_at
before update on public.buy_items
for each row
execute function public.set_buy_items_updated_at();

alter table public.buy_items enable row level security;

drop policy if exists "allow anon read buy_items" on public.buy_items;
create policy "allow anon read buy_items"
on public.buy_items for select
to anon
using (true);

drop policy if exists "allow anon insert buy_items" on public.buy_items;
create policy "allow anon insert buy_items"
on public.buy_items for insert
to anon
with check (true);

drop policy if exists "allow anon update buy_items" on public.buy_items;
create policy "allow anon update buy_items"
on public.buy_items for update
to anon
using (true)
with check (true);

drop policy if exists "allow anon delete buy_items" on public.buy_items;
create policy "allow anon delete buy_items"
on public.buy_items for delete
to anon
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'buy_items'
  ) then
    alter publication supabase_realtime add table public.buy_items;
  end if;
end;
$$;
