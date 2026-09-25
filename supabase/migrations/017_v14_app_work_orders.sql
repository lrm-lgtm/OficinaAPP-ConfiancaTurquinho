-- v14.0 scoped app work-order RPCs
create or replace function public.assignable_staff()
returns table(user_id uuid,full_name text,role text)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not (private.has_permission('work_orders.write_all') or private.has_permission('team.read')) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  return query
  select sp.id,sp.full_name,sp.role
  from public.staff_profiles sp
  where sp.active=true and sp.role in ('owner','manager','mechanic')
  order by case sp.role when 'mechanic' then 1 when 'manager' then 2 else 3 end,sp.full_name;
end
$$;

create or replace function public.work_orders_for_app()
returns table(
  id uuid,number bigint,customer_id uuid,vehicle_id uuid,status text,complaint text,current_km integer,
  created_at timestamptz,customer_promised_at timestamptz,forecast_at timestamptz,operational_state text,
  blocked_since timestamptz,blocked_reason text,next_review_at timestamptz,priority text,assigned_to uuid,
  assigned_name text,customer_name text,plate text,vehicle_make text,vehicle_model text,vehicle_version text,
  vehicle_year integer,vehicle_km integer
)
language sql stable security definer set search_path=''
as $$
  select w.id,w.number,w.customer_id,w.vehicle_id,w.status,w.complaint,w.current_km,w.created_at,
    w.customer_promised_at,w.forecast_at,w.operational_state,w.blocked_since,w.blocked_reason,w.next_review_at,
    w.priority,w.assigned_to,assignee.full_name,c.name,v.plate,v.make,v.model,v.version,v.year,v.km
  from public.work_orders w
  join public.customers c on c.id=w.customer_id
  left join public.vehicles v on v.id=w.vehicle_id
  left join public.staff_profiles assignee on assignee.id=w.assigned_to
  where private.can_access_work_order(w.id,false)
  order by w.created_at desc
$$;

revoke all on function public.assignable_staff() from public,anon;
revoke all on function public.work_orders_for_app() from public,anon;
grant execute on function public.assignable_staff() to authenticated;
grant execute on function public.work_orders_for_app() to authenticated;
