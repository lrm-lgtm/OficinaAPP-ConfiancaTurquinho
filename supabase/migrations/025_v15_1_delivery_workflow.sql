-- v15.1 delivery workflow: exit inspection + controlled closeout

create or replace function public.complete_work_order_delivery(
  p_work_order_id uuid,
  p_final_km integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  exit_photo_count integer;
  unresolved_parts integer;
  delivered_at timestamptz;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  select * into w
  from public.work_orders
  where id=p_work_order_id
  for update;

  if not found then raise exception 'work_order_not_found'; end if;

  if w.status='delivered' then
    return jsonb_build_object(
      'ok',true,
      'already_delivered',true,
      'work_order_id',w.id,
      'closed_at',w.closed_at
    );
  end if;

  if w.status<>'ready' then
    raise exception 'work_order_not_ready';
  end if;

  select count(distinct ip.slot) into exit_photo_count
  from public.inspection_photos ip
  where ip.work_order_id=w.id
    and ip.phase='exit'
    and ip.required=true
    and ip.slot in ('front','rear','left','right');

  if exit_photo_count<4 then
    raise exception 'exit_inspection_incomplete';
  end if;

  select count(*) into unresolved_parts
  from public.stock_reservations sr
  where sr.work_order_id=w.id
    and sr.quantity>sr.consumed_qty+sr.released_qty;

  if unresolved_parts>0 then
    raise exception 'unresolved_stock_reservations';
  end if;

  if p_final_km is not null and p_final_km<0 then
    raise exception 'invalid_final_km';
  end if;

  if p_final_km is not null and w.vehicle_id is not null then
    update public.vehicles
    set km=greatest(coalesce(km,0),p_final_km)
    where id=w.vehicle_id;
  end if;

  delivered_at:=now();

  update public.work_orders
  set status='delivered',
      closed_at=delivered_at,
      blocked_since=null,
      blocked_reason=null,
      next_review_at=null,
      updated_at=delivered_at
  where id=w.id;

  insert into public.activity_log(
    work_order_id,actor_user_id,actor_type,event_type,payload
  )
  values(
    w.id,(select auth.uid()),'user','work_order_delivered',
    jsonb_build_object(
      'final_km',p_final_km,
      'exit_photo_count',exit_photo_count,
      'delivered_at',delivered_at
    )
  );

  return jsonb_build_object(
    'ok',true,
    'already_delivered',false,
    'work_order_id',w.id,
    'closed_at',delivered_at,
    'final_km',p_final_km
  );
end
$$;

revoke all on function public.complete_work_order_delivery(uuid,integer) from public,anon;
grant execute on function public.complete_work_order_delivery(uuid,integer) to authenticated;
