-- v15.4 work-order state integrity
-- Prevents operational shortcuts from marking work ready/delivered before prerequisites are met.

create or replace function private.enforce_work_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  unresolved_parts integer;
  exit_photo_count integer;
begin
  if old.status in ('delivered','cancelled')
     and new.status is distinct from old.status then
    raise exception 'closed_work_order_immutable';
  end if;

  if new.status='ready' and old.status is distinct from new.status then
    if old.status not in ('approved','in_service') then
      raise exception 'ready_requires_approved_work';
    end if;

    select count(*) into unresolved_parts
    from public.stock_reservations sr
    where sr.work_order_id=old.id
      and sr.quantity>sr.consumed_qty+sr.released_qty;

    if unresolved_parts>0 then
      raise exception 'unresolved_stock_reservations';
    end if;
  end if;

  if new.status='delivered' and old.status is distinct from new.status then
    if old.status<>'ready' then
      raise exception 'delivered_requires_ready';
    end if;

    select count(distinct ip.slot) into exit_photo_count
    from public.inspection_photos ip
    where ip.work_order_id=old.id
      and ip.phase='exit'
      and ip.required=true
      and ip.slot in ('front','rear','left','right');

    if exit_photo_count<4 then
      raise exception 'exit_inspection_incomplete';
    end if;

    select count(*) into unresolved_parts
    from public.stock_reservations sr
    where sr.work_order_id=old.id
      and sr.quantity>sr.consumed_qty+sr.released_qty;

    if unresolved_parts>0 then
      raise exception 'unresolved_stock_reservations';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists work_orders_status_integrity on public.work_orders;
create trigger work_orders_status_integrity
before update of status on public.work_orders
for each row
execute function private.enforce_work_order_status_transition();
