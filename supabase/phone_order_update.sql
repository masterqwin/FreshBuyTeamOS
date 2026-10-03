begin;

alter table public.phone_order_items enable row level security;

drop policy if exists "allow anon update phone_order_items"
on public.phone_order_items;

create policy "allow anon update phone_order_items"
on public.phone_order_items
for update
to anon
using (true)
with check (
  nullif(btrim(product_name), '') is not null
  and nullif(btrim(quantity), '') is not null
  and nullif(btrim(unit), '') is not null
  and nullif(btrim(supplier_name), '') is not null
);

-- Make sure anon does not retain broad table-level UPDATE permission.
revoke update on public.phone_order_items from anon;

-- Allow editing only the three approved snapshot fields.
grant update (quantity, unit, supplier_name)
on public.phone_order_items
to anon;

commit;