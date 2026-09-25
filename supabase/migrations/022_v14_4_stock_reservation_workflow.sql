-- v14.4 reservation-aware stock RPCs and execution permissions

insert into public.permission_catalog(permission,category,label,description,sort_order,visible) values
('stock.consume_all','Estoque','Instalar / liberar peças','Confirma consumo ou libera reservas de qualquer OS.',155,true),
('stock.consume_assigned','Estoque','Instalar peças atribuídas','Confirma consumo ou libera reservas somente das OS atribuídas.',156,true)
on conflict (permission) do update set
category=excluded.category,label=excluded.label,description=excluded.description,sort_order=excluded.sort_order,visible=excluded.visible;

insert into public.role_permissions(role,permission,enabled) values
('manager','stock.consume_all',true),
('mechanic','stock.consume_assigned',true)
on conflict (role,permission) do update set enabled=excluded.enabled;

create or replace function public.stock_catalog_for_app()
returns table(
  id uuid,kind text,name text,sku text,unit text,sale_price numeric,track_stock boolean,
  stock_qty numeric,min_stock_qty numeric,favorite boolean,usage_count integer,last_used_at timestamptz,
  reserved_qty numeric,available_qty numeric,shortage_qty numeric
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not private.has_permission('catalog.read') then raise exception 'not_allowed' using errcode='42501'; end if;
  return query
  select ci.id,ci.kind,ci.name,ci.sku,ci.unit,ci.sale_price,ci.track_stock,ci.stock_qty,ci.min_stock_qty,
    ci.favorite,ci.usage_count,ci.last_used_at,
    coalesce(r.reserved_qty,0)::numeric,
    greatest(0,ci.stock_qty-coalesce(r.reserved_qty,0))::numeric,
    greatest(0,coalesce(r.demand_qty,0)-ci.stock_qty)::numeric
  from public.catalog_items ci
  left join (
    select catalog_item_id,sum(reserved_qty) as reserved_qty,
      sum(greatest(0,quantity-consumed_qty-released_qty)) as demand_qty
    from public.stock_reservations
    where quantity>consumed_qty+released_qty
    group by catalog_item_id
  ) r on r.catalog_item_id=ci.id
  where ci.active=true
  order by ci.track_stock desc,ci.name;
end
$$;

create or replace function public.work_order_parts(p_work_order_id uuid)
returns table(
  reservation_id uuid,catalog_item_id uuid,item_name text,sku text,unit text,
  required_qty numeric,reserved_qty numeric,consumed_qty numeric,released_qty numeric,
  shortage_qty numeric,stock_qty numeric
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not private.can_access_work_order(p_work_order_id,false) then raise exception 'not_allowed' using errcode='42501'; end if;
  return query
  select sr.id,sr.catalog_item_id,ci.name,ci.sku,ci.unit,sr.quantity,sr.reserved_qty,
    sr.consumed_qty,sr.released_qty,
    greatest(0,sr.quantity-sr.reserved_qty-sr.consumed_qty-sr.released_qty)::numeric,
    ci.stock_qty
  from public.stock_reservations sr
  join public.catalog_items ci on ci.id=sr.catalog_item_id
  where sr.work_order_id=p_work_order_id
  order by sr.created_at,sr.id;
end
$$;

create or replace function public.consume_reserved_stock(p_reservation_id uuid,p_quantity numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare r public.stock_reservations; item public.catalog_items; movement_id uuid; allowed boolean;
begin
  select * into r from public.stock_reservations where id=p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  allowed:=(
    private.has_permission('stock.consume_all') and private.can_access_work_order(r.work_order_id,false)
  ) or (
    private.has_permission('stock.consume_assigned') and private.can_access_work_order(r.work_order_id,true)
  );
  if not allowed then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>r.reserved_qty then raise exception 'invalid_quantity'; end if;

  select * into item from public.catalog_items where id=r.catalog_item_id for update;
  if item.stock_qty<p_quantity then raise exception 'insufficient_stock'; end if;

  update public.stock_reservations
  set reserved_qty=reserved_qty-p_quantity,consumed_qty=consumed_qty+p_quantity,updated_at=now()
  where id=r.id;

  insert into public.stock_movements(catalog_item_id,work_order_id,movement_type,quantity_delta,note,created_by)
  values(r.catalog_item_id,r.work_order_id,'consume',-p_quantity,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()))
  returning id into movement_id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(r.work_order_id,(select auth.uid()),'user','reserved_part_consumed',
    jsonb_build_object('reservation_id',r.id,'catalog_item_id',r.catalog_item_id,'quantity',p_quantity,'movement_id',movement_id));

  return movement_id;
end
$$;

create or replace function public.release_reserved_stock(p_reservation_id uuid,p_note text default null)
returns numeric language plpgsql security definer set search_path=''
as $$
declare r public.stock_reservations; outstanding numeric; allowed boolean;
begin
  select * into r from public.stock_reservations where id=p_reservation_id for update;
  if not found then raise exception 'reservation_not_found'; end if;

  allowed:=(
    private.has_permission('stock.consume_all') and private.can_access_work_order(r.work_order_id,false)
  ) or (
    private.has_permission('stock.consume_assigned') and private.can_access_work_order(r.work_order_id,true)
  );
  if not allowed then raise exception 'not_allowed' using errcode='42501'; end if;

  outstanding:=greatest(0,r.quantity-r.consumed_qty-r.released_qty);
  if outstanding<=0 then return 0; end if;

  perform private.release_reservation_remaining(r.id);
  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(r.work_order_id,(select auth.uid()),'user','reserved_part_released',
    jsonb_build_object('reservation_id',r.id,'catalog_item_id',r.catalog_item_id,'quantity',outstanding,
      'note',nullif(trim(coalesce(p_note,'')),'')));
  return outstanding;
end
$$;

create or replace function public.record_stock_movement(
  p_catalog_item_id uuid,p_movement_type text,p_quantity numeric,p_work_order_id uuid default null,
  p_note text default null,p_unit_cost numeric default null
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare item public.catalog_items; delta numeric; movement_id uuid; reserved_total numeric; free_physical numeric;
begin
  if not private.has_permission('catalog.write') then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_movement_type not in ('entry','consume','return','adjustment') then raise exception 'invalid_movement_type'; end if;

  select * into item from public.catalog_items where id=p_catalog_item_id and active=true for update;
  if not found then raise exception 'catalog_item_not_found'; end if;
  if item.track_stock=false then raise exception 'stock_not_enabled'; end if;
  if p_quantity is null or p_quantity=0 then raise exception 'invalid_quantity'; end if;

  delta:=case when p_movement_type='entry' then abs(p_quantity)
              when p_movement_type='return' then abs(p_quantity)
              when p_movement_type='consume' then -abs(p_quantity)
              else p_quantity end;

  select coalesce(sum(reserved_qty),0) into reserved_total
  from public.stock_reservations where catalog_item_id=item.id;
  free_physical:=greatest(0,item.stock_qty-reserved_total);
  if delta<0 and abs(delta)>free_physical then raise exception 'stock_reserved_or_insufficient'; end if;

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
        average_cost=case when public.catalog_item_costs.average_cost is null then excluded.average_cost
                          else round((public.catalog_item_costs.average_cost+excluded.last_cost)/2,2) end,
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

drop policy if exists stock_movements_insert on public.stock_movements;

create or replace function private.catalog_stock_tracking_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
declare pending_count integer; r record;
begin
  if old.track_stock=true and new.track_stock=false then
    select count(*) into pending_count
    from public.stock_reservations sr
    where sr.catalog_item_id=new.id and sr.quantity>sr.consumed_qty+sr.released_qty;
    if pending_count>0 then raise exception 'active_reservations_exist'; end if;
  end if;

  if old.track_stock=false and new.track_stock=true then
    for r in
      select distinct br.id
      from public.budget_items bi
      join public.budget_revisions br on br.id=bi.budget_revision_id
      where bi.catalog_item_id=new.id and br.status='approved'
      order by br.id
    loop
      perform private.reserve_budget_stock(r.id);
    end loop;
  end if;
  return new;
end
$$;

drop trigger if exists catalog_stock_tracking_guard on public.catalog_items;
create trigger catalog_stock_tracking_guard
after update of track_stock on public.catalog_items
for each row
when (old.track_stock is distinct from new.track_stock)
execute function private.catalog_stock_tracking_guard();

revoke all on function public.stock_catalog_for_app() from public,anon;
revoke all on function public.work_order_parts(uuid) from public,anon;
revoke all on function public.consume_reserved_stock(uuid,numeric,text) from public,anon;
revoke all on function public.release_reserved_stock(uuid,text) from public,anon;
grant execute on function public.stock_catalog_for_app() to authenticated;
grant execute on function public.work_order_parts(uuid) to authenticated;
grant execute on function public.consume_reserved_stock(uuid,numeric,text) to authenticated;
grant execute on function public.release_reserved_stock(uuid,text) to authenticated;
