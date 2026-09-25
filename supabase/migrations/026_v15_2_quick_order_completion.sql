-- v15.2 quick-order completion without creating a duplicate OS

create or replace function public.complete_quick_work_order(
  p_work_order_id uuid,
  p_vehicle_id uuid default null,
  p_complaint text default null,
  p_current_km integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  vehicle_customer uuid;
  entry_photo_count integer;
  existing_budget uuid;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  select * into w
  from public.work_orders
  where id=p_work_order_id
  for update;

  if not found then raise exception 'work_order_not_found'; end if;

  if w.status not in ('open','inspection','budget') then
    raise exception 'work_order_not_completable';
  end if;

  if p_current_km is not null and p_current_km<0 then
    raise exception 'invalid_km';
  end if;

  if p_vehicle_id is not null then
    select customer_id into vehicle_customer
    from public.vehicles
    where id=p_vehicle_id;

    if vehicle_customer is null then raise exception 'vehicle_not_found'; end if;
    if vehicle_customer<>w.customer_id then raise exception 'vehicle_customer_mismatch'; end if;
  end if;

  select count(distinct ip.slot) into entry_photo_count
  from public.inspection_photos ip
  where ip.work_order_id=w.id
    and ip.phase='entry'
    and ip.required=true
    and ip.slot in ('front','rear','left','right');

  if entry_photo_count<4 then
    raise exception 'entry_inspection_incomplete';
  end if;

  update public.work_orders
  set vehicle_id=coalesce(p_vehicle_id,vehicle_id),
      complaint=coalesce(nullif(trim(coalesce(p_complaint,'')),''),complaint),
      current_km=coalesce(p_current_km,current_km),
      status='budget',
      operational_state='active',
      blocked_since=null,
      blocked_reason=null,
      updated_at=now()
  where id=w.id;

  if p_vehicle_id is not null and p_current_km is not null then
    update public.vehicles
    set km=greatest(coalesce(km,0),p_current_km)
    where id=p_vehicle_id;
  end if;

  select br.id into existing_budget
  from public.budget_revisions br
  where br.work_order_id=w.id
  order by br.revision desc
  limit 1;

  if existing_budget is null then
    insert into public.budget_revisions(
      work_order_id,revision,status,subtotal,total,created_by
    )
    values(
      w.id,1,'draft',0,0,(select auth.uid())
    )
    returning id into existing_budget;
  end if;

  insert into public.activity_log(
    work_order_id,actor_user_id,actor_type,event_type,payload
  )
  values(
    w.id,(select auth.uid()),'user','work_order_quick_completed',
    jsonb_build_object(
      'vehicle_id',p_vehicle_id,
      'current_km',p_current_km,
      'entry_photo_count',entry_photo_count,
      'budget_revision_id',existing_budget
    )
  );

  return jsonb_build_object(
    'ok',true,
    'work_order_id',w.id,
    'budget_revision_id',existing_budget,
    'status','budget'
  );
end
$$;

revoke all on function public.complete_quick_work_order(uuid,uuid,text,integer) from public,anon;
grant execute on function public.complete_quick_work_order(uuid,uuid,text,integer) to authenticated;
