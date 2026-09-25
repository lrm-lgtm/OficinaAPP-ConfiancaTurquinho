-- v15.5 follow-up: redeploy corrected cancellation RPC after alias-collision fix

-- v15.5 safe work-order cancellation
-- Cancels only when no physical stock was consumed, no money was received,
-- and no live electronic payment request can still be paid.

create or replace function public.cancel_work_order(
  p_work_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  normalized_reason text;
  consumed_total numeric;
  received_total numeric;
  active_payment_requests integer;
  released_total numeric:=0;
  released_rows integer:=0;
  cancelled_receivables integer:=0;
  reservation_row record;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  normalized_reason:=nullif(trim(coalesce(p_reason,'')),'');
  if normalized_reason is null or length(normalized_reason)<5 then
    raise exception 'cancel_reason_required';
  end if;

  select * into w
  from public.work_orders
  where id=p_work_order_id
  for update;

  if not found then raise exception 'work_order_not_found'; end if;
  if w.status='delivered' then raise exception 'delivered_work_order_cannot_cancel'; end if;

  if w.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'already_cancelled',true,
      'work_order_id',w.id,
      'closed_at',w.closed_at
    );
  end if;

  select coalesce(sum(sr.consumed_qty),0) into consumed_total
  from public.stock_reservations sr
  where sr.work_order_id=w.id;

  if consumed_total>0 then
    raise exception 'cancel_requires_stock_adjustment';
  end if;

  select greatest(
    coalesce((select sum(recv.paid_amount) from public.receivables recv where recv.work_order_id=w.id),0),
    coalesce((select sum(p.amount) from public.payments p where p.work_order_id=w.id and p.status='approved'),0)
  ) into received_total;

  if received_total>0 then
    raise exception 'cancel_requires_financial_adjustment';
  end if;

  select count(*) into active_payment_requests
  from public.payment_requests pr
  where pr.work_order_id=w.id
    and pr.status in ('pending','processing');

  if active_payment_requests>0 then
    raise exception 'cancel_has_active_payment_request';
  end if;

  for reservation_row in
    select sr.id,
           greatest(0,sr.quantity-sr.consumed_qty-sr.released_qty) as outstanding
    from public.stock_reservations sr
    where sr.work_order_id=w.id
      and sr.quantity>sr.consumed_qty+sr.released_qty
    order by sr.created_at,sr.id
    for update
  loop
    released_total:=released_total+reservation_row.outstanding;
    released_rows:=released_rows+1;
    perform private.release_reservation_remaining(reservation_row.id);
  end loop;

  update public.approval_tokens at
  set revoked_at=coalesce(at.revoked_at,now())
  where at.budget_revision_id in (
    select br.id from public.budget_revisions br where br.work_order_id=w.id
  )
    and at.revoked_at is null;

  update public.budget_revisions
  set status='cancelled'
  where work_order_id=w.id
    and status in ('draft','sent','revision_requested');

  update public.payment_requests
  set status='cancelled'
  where work_order_id=w.id
    and status in ('draft','provider_error')
    and provider_payment_id is null;

  update public.receivables
  set status='cancelled'
  where work_order_id=w.id
    and paid_amount=0
    and status in ('open','overdue');
  get diagnostics cancelled_receivables=row_count;

  update public.work_orders
  set status='cancelled',
      closed_at=now(),
      operational_state='active',
      blocked_since=null,
      blocked_reason=null,
      next_review_at=null,
      updated_at=now()
  where id=w.id;

  insert into public.activity_log(
    work_order_id,actor_user_id,actor_type,event_type,payload
  )
  values(
    w.id,(select auth.uid()),'user','work_order_cancelled',
    jsonb_build_object(
      'reason',normalized_reason,
      'released_reservations',released_rows,
      'released_quantity',released_total,
      'cancelled_receivables',cancelled_receivables
    )
  );

  return jsonb_build_object(
    'ok',true,
    'already_cancelled',false,
    'work_order_id',w.id,
    'released_reservations',released_rows,
    'released_quantity',released_total,
    'cancelled_receivables',cancelled_receivables
  );
end
$$;

revoke all on function public.cancel_work_order(uuid,text) from public,anon;
grant execute on function public.cancel_work_order(uuid,text) to authenticated;
