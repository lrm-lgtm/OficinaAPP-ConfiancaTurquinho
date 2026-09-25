-- v14.3 approved-budget stock reservations

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  budget_revision_id uuid not null references public.budget_revisions(id) on delete cascade,
  budget_item_id uuid not null references public.budget_items(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  quantity numeric(12,3) not null check (quantity > 0),
  reserved_qty numeric(12,3) not null default 0 check (reserved_qty >= 0),
  consumed_qty numeric(12,3) not null default 0 check (consumed_qty >= 0),
  released_qty numeric(12,3) not null default 0 check (released_qty >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_item_id),
  check (reserved_qty + consumed_qty + released_qty <= quantity)
);

create index if not exists stock_reservations_catalog_idx on public.stock_reservations(catalog_item_id,created_at);
create index if not exists stock_reservations_work_order_idx on public.stock_reservations(work_order_id);
create index if not exists stock_reservations_revision_idx on public.stock_reservations(budget_revision_id);

alter table public.stock_reservations enable row level security;
drop policy if exists stock_reservations_read on public.stock_reservations;
create policy stock_reservations_read on public.stock_reservations
for select to authenticated
using (private.has_permission('catalog.write') or private.can_access_work_order(work_order_id,false));

create or replace function private.allocate_stock_shortages(p_catalog_item_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare physical numeric; already_reserved numeric; free_qty numeric; r record; shortage numeric; give_qty numeric;
begin
  select stock_qty into physical from public.catalog_items where id=p_catalog_item_id for update;
  if physical is null then return; end if;

  select coalesce(sum(reserved_qty),0) into already_reserved
  from public.stock_reservations
  where catalog_item_id=p_catalog_item_id and quantity>consumed_qty+released_qty;

  free_qty:=greatest(0,physical-already_reserved);
  if free_qty<=0 then return; end if;

  for r in
    select id,quantity,reserved_qty,consumed_qty,released_qty
    from public.stock_reservations
    where catalog_item_id=p_catalog_item_id
      and quantity>reserved_qty+consumed_qty+released_qty
    order by created_at,id
    for update
  loop
    exit when free_qty<=0;
    shortage:=greatest(0,r.quantity-r.reserved_qty-r.consumed_qty-r.released_qty);
    give_qty:=least(shortage,free_qty);
    if give_qty>0 then
      update public.stock_reservations set reserved_qty=reserved_qty+give_qty,updated_at=now() where id=r.id;
      free_qty:=free_qty-give_qty;
    end if;
  end loop;
end
$$;

create or replace function private.release_reservation_remaining(p_reservation_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare r public.stock_reservations; outstanding numeric;
begin
  select * into r from public.stock_reservations where id=p_reservation_id for update;
  if not found then return; end if;
  outstanding:=greatest(0,r.quantity-r.consumed_qty-r.released_qty);
  if outstanding<=0 then return; end if;

  update public.stock_reservations
  set released_qty=released_qty+outstanding,reserved_qty=0,updated_at=now()
  where id=r.id;

  perform private.allocate_stock_shortages(r.catalog_item_id);
end
$$;

create or replace function private.reserve_budget_stock(p_budget_revision_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare wo_id uuid; line record; item public.catalog_items; active_reserved numeric; free_qty numeric; allocate_qty numeric; old record;
begin
  select work_order_id into wo_id from public.budget_revisions where id=p_budget_revision_id;
  if wo_id is null then return; end if;

  for old in
    select sr.id from public.stock_reservations sr
    where sr.work_order_id=wo_id
      and sr.budget_revision_id<>p_budget_revision_id
      and sr.quantity>sr.consumed_qty+sr.released_qty
    for update
  loop
    perform private.release_reservation_remaining(old.id);
  end loop;

  for line in
    select bi.id as budget_item_id,bi.catalog_item_id,bi.quantity
    from public.budget_items bi
    join public.catalog_items ci on ci.id=bi.catalog_item_id
    where bi.budget_revision_id=p_budget_revision_id
      and bi.catalog_item_id is not null
      and ci.track_stock=true and ci.active=true and bi.quantity>0
    order by bi.sort_order,bi.id
  loop
    if exists(select 1 from public.stock_reservations where budget_item_id=line.budget_item_id) then continue; end if;

    select * into item from public.catalog_items where id=line.catalog_item_id for update;
    select coalesce(sum(reserved_qty),0) into active_reserved
    from public.stock_reservations where catalog_item_id=line.catalog_item_id;

    free_qty:=greatest(0,item.stock_qty-active_reserved);
    allocate_qty:=least(line.quantity,free_qty);

    insert into public.stock_reservations(
      work_order_id,budget_revision_id,budget_item_id,catalog_item_id,quantity,reserved_qty,consumed_qty,released_qty
    ) values(wo_id,p_budget_revision_id,line.budget_item_id,line.catalog_item_id,line.quantity,allocate_qty,0,0);
  end loop;
end
$$;

create or replace function private.approval_stock_reservation_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.decision='approved' then perform private.reserve_budget_stock(new.budget_revision_id); end if;
  return new;
end
$$;

drop trigger if exists approval_stock_reservation on public.approvals;
create trigger approval_stock_reservation
after insert on public.approvals
for each row execute function private.approval_stock_reservation_trigger();

create or replace function private.release_closed_work_order_reservations()
returns trigger language plpgsql security definer set search_path=''
as $$
declare r record;
begin
  if new.status in ('cancelled','delivered') and old.status is distinct from new.status then
    for r in
      select id from public.stock_reservations
      where work_order_id=new.id and quantity>consumed_qty+released_qty
      for update
    loop
      perform private.release_reservation_remaining(r.id);
    end loop;
  end if;
  return new;
end
$$;

drop trigger if exists work_order_release_stock_reservations on public.work_orders;
create trigger work_order_release_stock_reservations
after update of status on public.work_orders
for each row execute function private.release_closed_work_order_reservations();

create or replace function private.apply_stock_movement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update public.catalog_items set stock_qty=stock_qty+new.quantity_delta,updated_at=now()
  where id=new.catalog_item_id;
  if new.quantity_delta>0 then perform private.allocate_stock_shortages(new.catalog_item_id); end if;
  return new;
end
$$;

do $$
declare r record;
begin
  for r in select id from public.budget_revisions where status='approved' order by approved_at nulls last,created_at
  loop perform private.reserve_budget_stock(r.id); end loop;
end $$;
