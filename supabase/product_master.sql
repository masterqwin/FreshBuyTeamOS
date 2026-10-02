-- FreshBuy Team OS Product Master (Phase 1)
-- OWNER/ADMIN SQL EDITOR ONLY. Review, then run once before deploying the UI.
-- This migration does not modify or delete any public.buy_items rows.

create extension if not exists "pgcrypto";

create table if not exists public.product_master (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  default_unit text not null,
  default_max_price text null,
  note text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_master_name_not_blank check (nullif(btrim(name), '') is not null),
  constraint product_master_unit_not_blank check (nullif(btrim(default_unit), '') is not null),
  constraint product_master_category_allowed check (
    category in ('ผักใบ', 'ผักผล', 'ผักเมืองหนาว', 'ผักแพ๊คและเห็ด', 'เครื่องเทศ', 'อื่นๆ')
  )
);

create unique index if not exists product_master_active_name_unique_idx
  on public.product_master (lower(btrim(name)))
  where active = true;

create index if not exists product_master_active_category_name_idx
  on public.product_master (active, category, name);

create or replace function public.set_product_master_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_master_set_updated_at on public.product_master;
create trigger product_master_set_updated_at
before update on public.product_master
for each row
execute function public.set_product_master_updated_at();

alter table public.product_master enable row level security;

drop policy if exists "allow anon read product_master" on public.product_master;
create policy "allow anon read product_master"
on public.product_master for select
to anon
using (true);

drop policy if exists "allow anon insert product_master" on public.product_master;
create policy "allow anon insert product_master"
on public.product_master for insert
to anon
with check (active = true);

drop policy if exists "allow anon update product_master" on public.product_master;
create policy "allow anon update product_master"
on public.product_master for update
to anon
using (true)
with check (true);

grant select, insert, update on public.product_master to anon;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'product_master'
  ) then
    alter publication supabase_realtime add table public.product_master;
  end if;
end;
$$;

-- Validation after running:
select id, name, category, default_unit, default_max_price, note, active, created_at, updated_at
from public.product_master
order by category, name;
