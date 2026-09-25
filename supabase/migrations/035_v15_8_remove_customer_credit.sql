-- v15.8 remove customer-credit path
-- Business rule: customer never carries store credit. Cancellation payment resolution is refund or keep charged.

alter table public.cancellation_payment_resolutions
  drop constraint if exists cancellation_payment_resolutions_action_check;

alter table public.cancellation_payment_resolutions
  add constraint cancellation_payment_resolutions_action_check
  check (action in ('refund','keep_charged'));

create or replace function public.resolve_cancellation_payment(
  p_work_order_id uuid,
  p_payment_id uuid,
  p_action text,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  p public.payments;
  already_resolved numeric;
  resolution_id uuid;
  refund_id uuid;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if not private.has_permission('finance.write') then
    raise exception 'finance_adjustment_not_allowed' using errcode='42501';
  end if;
  if p_action not in ('refund','keep_charged') then
    raise exception 'invalid_payment_resolution';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'invalid_amount'; end if;

  select * into w
  from public.work_orders
  where id=p_work_order_id
  for update;
  if not found then raise exception 'work_order_not_found'; end if;
  if w.status in ('delivered','cancelled') then raise exception 'work_order_closed'; end if;

  select * into p
  from public.payments
  where id=p_payment_id and work_order_id=w.id
  for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status not in ('approved','partially_refunded') then raise exception 'payment_not_adjustable'; end if;

  already_resolved:=private.cancellation_payment_resolved_amount(p.id);
  if p_amount>greatest(0,p.amount-already_resolved) then
    raise exception 'resolution_exceeds_payment';
  end if;

  if p_action='refund' then
    if p.provider='mercadopago' and p.provider_payment_id is not null then
      raise exception 'provider_refund_required';
    end if;
    refund_id:=private.record_cancellation_refund(
      p.id,p_amount,'manual',null,'{}'::jsonb,p_note,'user',(select auth.uid())
    );
    return jsonb_build_object(
      'ok',true,
      'action','refund',
      'refund_id',refund_id,
      'remaining',greatest(0,p.amount-already_resolved-p_amount)
    );
  end if;

  insert into public.cancellation_payment_resolutions(
    work_order_id,payment_id,action,amount,note,source,created_by
  )
  values(
    w.id,p.id,'keep_charged',p_amount,
    nullif(trim(coalesce(p_note,'')),''),
    'user',(select auth.uid())
  )
  returning id into resolution_id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(
    w.id,(select auth.uid()),'user','cancellation_payment_resolved',
    jsonb_build_object(
      'resolution_id',resolution_id,
      'payment_id',p.id,
      'action','keep_charged',
      'amount',p_amount,
      'note',nullif(trim(coalesce(p_note,'')),'')
    )
  );

  return jsonb_build_object(
    'ok',true,
    'action','keep_charged',
    'resolution_id',resolution_id,
    'remaining',greatest(0,p.amount-already_resolved-p_amount)
  );
end
$$;

create or replace view public.work_order_financial_summary
with (security_invoker=true)
as
select
  w.id as work_order_id,
  coalesce((
    select sum(r.amount)
    from public.receivables r
    where r.work_order_id=w.id and r.status<>'cancelled'
  ),0) as receivable_total,
  greatest(
    0,
    coalesce((
      select sum(p.amount)
      from public.payments p
      where p.work_order_id=w.id
        and p.status in ('approved','partially_refunded','refunded')
    ),0)
    - coalesce((
      select sum(pr.amount)
      from public.payment_refunds pr
      where pr.work_order_id=w.id and pr.status='approved'
    ),0)
  ) as received_total,
  coalesce((
    select sum(ft.amount)
    from public.financial_transactions ft
    where ft.work_order_id=w.id
      and ft.direction='expense'
      and ft.status<>'cancelled'
      and ft.category<>'Estorno de recebimento'
  ),0) as expense_total,
  coalesce((
    select sum(pi.line_cost)
    from public.purchase_items pi
    join public.purchases pu on pu.id=pi.purchase_id
    where pu.work_order_id=w.id and pu.payment_status<>'cancelled'
  ),0) as purchase_cost_total
from public.work_orders w;

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
  unresolved_stock integer;
  unresolved_payments integer;
  active_payment_requests integer;
  released_total numeric:=0;
  released_rows integer:=0;
  adjusted_receivables integer:=0;
  retained_total numeric:=0;
  refunded_total numeric:=0;
  reservation_row record;
  receivable_row record;
  retained_for_receivable numeric;
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
      'ok',true,'already_cancelled',true,'work_order_id',w.id,'closed_at',w.closed_at
    );
  end if;

  select count(*) into unresolved_stock
  from public.stock_reservations sr
  where sr.work_order_id=w.id
    and sr.consumed_qty>private.cancellation_stock_resolved_qty(sr.id);

  if unresolved_stock>0 then
    raise exception 'cancel_requires_stock_adjustment';
  end if;

  select count(*) into unresolved_payments
  from public.payments p
  where p.work_order_id=w.id
    and p.status in ('approved','partially_refunded')
    and p.amount>private.cancellation_payment_resolved_amount(p.id);

  if unresolved_payments>0 then
    raise exception 'cancel_requires_financial_adjustment';
  end if;

  select count(*) into active_payment_requests
  from public.payment_requests pr
  where pr.work_order_id=w.id and pr.status in ('pending','processing');

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

  for receivable_row in
    select r.id
    from public.receivables r
    where r.work_order_id=w.id
    for update
  loop
    select coalesce(sum(cpr.amount),0) into retained_for_receivable
    from public.cancellation_payment_resolutions cpr
    join public.payments p on p.id=cpr.payment_id
    where p.receivable_id=receivable_row.id
      and cpr.action='keep_charged';

    if retained_for_receivable>0 then
      update public.receivables
      set amount=retained_for_receivable,
          paid_amount=retained_for_receivable,
          status='paid',
          due_at=null
      where id=receivable_row.id;
    else
      update public.receivables
      set paid_amount=0,status='cancelled',due_at=null
      where id=receivable_row.id;
    end if;
    adjusted_receivables:=adjusted_receivables+1;
  end loop;

  select coalesce(sum(amount),0) into retained_total
  from public.cancellation_payment_resolutions
  where work_order_id=w.id and action='keep_charged';

  select coalesce(sum(amount),0) into refunded_total
  from public.cancellation_payment_resolutions
  where work_order_id=w.id and action='refund';

  update public.work_orders
  set status='cancelled',
      closed_at=now(),
      operational_state='active',
      blocked_since=null,
      blocked_reason=null,
      next_review_at=null,
      updated_at=now()
  where id=w.id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(
    w.id,(select auth.uid()),'user','work_order_cancelled',
    jsonb_build_object(
      'reason',normalized_reason,
      'released_reservations',released_rows,
      'released_quantity',released_total,
      'adjusted_receivables',adjusted_receivables,
      'retained_amount',retained_total,
      'refunded_amount',refunded_total
    )
  );

  return jsonb_build_object(
    'ok',true,
    'already_cancelled',false,
    'work_order_id',w.id,
    'released_reservations',released_rows,
    'released_quantity',released_total,
    'adjusted_receivables',adjusted_receivables,
    'retained_amount',retained_total,
    'refunded_amount',refunded_total
  );
end
$$;

drop policy if exists customer_credits_read on public.customer_credits;
drop policy if exists customer_credits_no_direct_access on public.customer_credits;
drop table if exists public.customer_credits;
