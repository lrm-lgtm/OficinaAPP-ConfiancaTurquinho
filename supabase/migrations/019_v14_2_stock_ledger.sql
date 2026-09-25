-- v14.2 transactional stock ledger and private cost separation

create table if not exists public.catalog_item_costs (
  catalog_item_id uuid primary key references public.catalog_items(id) on delete cascade,
  last_cost numeric(12,2) check (last_cost is null or last_cost >= 0),
  average_cost numeric(12,2) check (average_cost is null or average_cost >= 0),
  updated_at timestamptz not null default now()
);

insert into public.catalog_item_costs(catalog_item_id,last_cost,average_cost)
select id,cost_price,cost_price
from public.catalog_items
where cost_price is not null
on conflict (catalog_item_id) do nothing;

alter table public.catalog_item_costs enable row level security;
drop policy if exists catalog_costs_read on public.catalog_item_costs;
drop policy if exists catalog_costs_write on public.catalog_item_costs;
create policy catalog_costs_read on public.catalog_item_costs
for select to authenticated using (private.has_permission('finance.read'));
create policy catalog_costs_write on public.catalog_item_costs
for all to authenticated
using (private.has_permission('finance.write'))
with check (private.has_permission('finance.write'));

alter table public.catalog_items
  add column if not exists min_stock_qty numeric(12,3) not null default 0;

revoke select on public.catalog_items from authenticated;
grant select (
  id,kind,name,sku,unit,sale_price,track_stock,stock_qty,min_stock_qty,
  favorite,active,usage_count,last_used_at,created_by,created_at,updated_at
) on public.catalog_items to authenticated;

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.catalog_items(id),
  work_order_id uuid references public.work_orders(id) on delete set null,
  movement_type text not null check (movement_type in ('entry','consume','return','adjustment')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_catalog_idx on public.stock_movements(catalog_item_id,created_at desc);
create index if not exists stock_movements_work_order_idx on public.stock_movements(work_order_id);

alter table public.stock_movements enable row level security;
drop policy if exists stock_movements_read on public.stock_movements;
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_read on public.stock_movements
for select to authenticated using (private.has_permission('catalog.write'));
create policy stock_movements_insert on public.stock_movements
for insert to authenticated with check (private.has_permission('catalog.write'));

create or replace function private.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.catalog_items
  set stock_qty=stock_qty+new.quantity_delta,updated_at=now()
  where id=new.catalog_item_id;
  return new;
end
$$;

drop trigger if exists stock_movement_apply on public.stock_movements;
create trigger stock_movement_apply
after insert on public.stock_movements
for each row execute function private.apply_stock_movement();

create or replace function public.record_stock_movement(
  p_catalog_item_id uuid,p_movement_type text,p_quantity numeric,
  p_work_order_id uuid default null,p_note text default null,p_unit_cost numeric default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare item public.catalog_items; delta numeric; movement_id uuid;
begin
  if not private.has_permission('catalog.write') then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_movement_type not in ('entry','consume','return','adjustment') then raise exception 'invalid_movement_type'; end if;

  select * into item from public.catalog_items where id=p_catalog_item_id and active=true for update;
  if not found then raise exception 'catalog_item_not_found'; end if;
  if item.track_stock=false then raise exception 'stock_not_enabled'; end if;
  if p_quantity is null or p_quantity=0 then raise exception 'invalid_quantity'; end if;

  delta:=case
    when p_movement_type='entry' then abs(p_quantity)
    when p_movement_type='return' then abs(p_quantity)
    when p_movement_type='consume' then -abs(p_quantity)
    else p_quantity
  end;

  if item.stock_qty+delta<0 then raise exception 'insufficient_stock'; end if;
  if p_work_order_id is not null and not private.can_access_work_order(p_work_order_id,false) then
    raise exception 'work_order_not_allowed' using errcode='42501';
  end if;

  insert into public.stock_movements(catalog_item_id,work_order_id,movement_type,quantity_delta,unit_cost,note,created_by)
  values(item.id,p_work_order_id,p_movement_type,delta,p_unit_cost,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()))
  returning id into movement_id;

  if p_unit_cost is not null and p_unit_cost>=0 and private.has_permission('finance.write') then
    insert into public.catalog_item_costs(catalog_item_id,last_cost,average_cost,updated_at)
    values(item.id,p_unit_cost,p_unit_cost,now())
    on conflict (catalog_item_id) do update
    set last_cost=excluded.last_cost,
        average_cost=case
          when public.catalog_item_costs.average_cost is null then excluded.average_cost
          else round((public.catalog_item_costs.average_cost+excluded.last_cost)/2,2)
        end,
        updated_at=now();
  end if;

  if p_work_order_id is not null then
    insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
    values(p_work_order_id,(select auth.uid()),'user','stock_movement_recorded',
      jsonb_build_object('catalog_item_id',item.id,'movement_id',movement_id,'movement_type',p_movement_type,'quantity_delta',delta));
  end if;

  return movement_id;
end
$$;

revoke all on function public.record_stock_movement(uuid,text,numeric,uuid,text,numeric) from public,anon;
grant execute on function public.record_stock_movement(uuid,text,numeric,uuid,text,numeric) to authenticated;
