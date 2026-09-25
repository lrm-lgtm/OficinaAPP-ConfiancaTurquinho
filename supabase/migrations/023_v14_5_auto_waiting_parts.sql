-- v14.5 automatically move approved OS to waiting-parts while reservations are short

create or replace function private.refresh_work_order_stock_state(p_work_order_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare shortage_count integer; current_state text; current_reason text;
begin
  select count(*) into shortage_count
  from public.stock_reservations sr
  where sr.work_order_id=p_work_order_id
    and greatest(0,sr.quantity-sr.reserved_qty-sr.consumed_qty-sr.released_qty)>0;

  select operational_state,blocked_reason into current_state,current_reason
  from public.work_orders where id=p_work_order_id for update;
  if not found then return; end if;

  if shortage_count>0 then
    update public.work_orders
    set operational_state='waiting_parts',
        blocked_since=case when current_state='waiting_parts' then blocked_since else now() end,
        blocked_reason='[ESTOQUE] Peça aprovada aguardando entrada em estoque',
        updated_at=now()
    where id=p_work_order_id;
  elsif current_reason like '[ESTOQUE]%' then
    update public.work_orders
    set operational_state='active',blocked_since=null,blocked_reason=null,updated_at=now()
    where id=p_work_order_id;
  elsif current_state='waiting_customer' then
    update public.work_orders
    set operational_state='active',blocked_since=null,blocked_reason=null,updated_at=now()
    where id=p_work_order_id;
  end if;
end
$$;

create or replace function private.allocate_stock_shortages(p_catalog_item_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare physical numeric; already_reserved numeric; free_qty numeric; r record; shortage numeric; give_qty numeric; wo record;
begin
  select stock_qty into physical from public.catalog_items where id=p_catalog_item_id for update;
  if physical is null then return; end if;

  select coalesce(sum(reserved_qty),0) into already_reserved
  from public.stock_reservations
  where catalog_item_id=p_catalog_item_id and quantity>consumed_qty+released_qty;

  free_qty:=greatest(0,physical-already_reserved);

  if free_qty>0 then
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
  end if;

  for wo in select distinct work_order_id from public.stock_reservations where catalog_item_id=p_catalog_item_id
  loop
    perform private.refresh_work_order_stock_state(wo.work_order_id);
  end loop;
end
$$;

create or replace function private.release_reservation_remaining(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path=''
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
  perform private.refresh_work_order_stock_state(r.work_order_id);
end
$$;

create or replace function private.reserve_budget_stock(p_budget_revision_id uuid)
returns void
language plpgsql
security definer
set search_path=''
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
      work_order_id,budget_revision_id,budget_item_id,catalog_item_id,
      quantity,reserved_qty,consumed_qty,released_qty
    ) values(
      wo_id,p_budget_revision_id,line.budget_item_id,line.catalog_item_id,
      line.quantity,allocate_qty,0,0
    );
  end loop;

  perform private.refresh_work_order_stock_state(wo_id);
end
$$;
