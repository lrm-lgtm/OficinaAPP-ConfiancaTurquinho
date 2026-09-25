-- v15.0 customer and vehicle service history
create or replace function public.customer_history_for_app(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  customer_row jsonb;
  vehicles_json jsonb;
  orders_json jsonb;
begin
  if not private.has_permission('customers.read') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  select jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'created_at',c.created_at
  )
  into customer_row
  from public.customers c
  where c.id=p_customer_id;

  if customer_row is null then raise exception 'customer_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',v.id,'plate',v.plate,'make',v.make,'model',v.model,'version',v.version,
    'year',v.year,'km',v.km,'notes',v.notes,'created_at',v.created_at
  ) order by v.created_at),'[]'::jsonb)
  into vehicles_json
  from public.vehicles v
  where v.customer_id=p_customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',w.id,'number',w.number,'vehicle_id',w.vehicle_id,'status',w.status,
    'complaint',w.complaint,'current_km',w.current_km,'created_at',w.created_at,
    'closed_at',w.closed_at,'customer_promised_at',w.customer_promised_at,
    'operational_state',w.operational_state,'assigned_to',w.assigned_to,
    'assigned_name',sp.full_name,
    'budget_total',case when private.has_permission('budgets.read') then (
      select br.total
      from public.budget_revisions br
      where br.work_order_id=w.id
      order by case br.status when 'approved' then 0 when 'sent' then 1 else 2 end,br.revision desc
      limit 1
    ) else null end
  ) order by w.created_at desc),'[]'::jsonb)
  into orders_json
  from public.work_orders w
  left join public.staff_profiles sp on sp.id=w.assigned_to
  where w.customer_id=p_customer_id
    and private.can_access_work_order(w.id,false);

  return jsonb_build_object('customer',customer_row,'vehicles',vehicles_json,'orders',orders_json);
end;
$$;

revoke all on function public.customer_history_for_app(uuid) from public,anon;
grant execute on function public.customer_history_for_app(uuid) to authenticated;
