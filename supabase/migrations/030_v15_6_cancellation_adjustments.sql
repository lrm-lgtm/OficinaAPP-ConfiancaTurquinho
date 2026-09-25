-- v15.6 cancellation adjustment center
-- Safe resolution of already-consumed stock, received money, customer credit and provider refunds.

create table if not exists public.cancellation_stock_resolutions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  reservation_id uuid not null references public.stock_reservations(id) on delete cascade,
  action text not null check (action in ('return_to_stock','write_off','keep_installed')),
  quantity numeric(12,3) not null check (quantity > 0),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cancellation_stock_resolutions_work_order_idx
  on public.cancellation_stock_resolutions(work_order_id);
create index if not exists cancellation_stock_resolutions_reservation_idx
  on public.cancellation_stock_resolutions(reservation_id);

create table if not exists public.cancellation_payment_resolutions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  action text not null check (action in ('refund','credit_customer','keep_charged')),
  amount numeric(12,2) not null check (amount > 0),
  note text,
  source text not null default 'user' check (source in ('user','provider','system')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists cancellation_payment_resolutions_work_order_idx
  on public.cancellation_payment_resolutions(work_order_id);
create index if not exists cancellation_payment_resolutions_payment_idx
  on public.cancellation_payment_resolutions(payment_id);

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete set null,
  provider text not null,
  provider_refund_id text,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'approved' check (status in ('pending','approved','rejected','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists payment_refunds_provider_unique
  on public.payment_refunds(provider,provider_refund_id)
  where provider_refund_id is not null;
create index if not exists payment_refunds_payment_idx
  on public.payment_refunds(payment_id);

create table if not exists public.customer_credits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_work_order_id uuid references public.work_orders(id) on delete set null,
  source_payment_id uuid references public.payments(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'available' check (status in ('available','applied','cancelled')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists customer_credits_customer_idx
  on public.customer_credits(customer_id,status);
create index if not exists customer_credits_work_order_idx
  on public.customer_credits(source_work_order_id);

alter table public.cancellation_stock_resolutions enable row level security;
alter table public.cancellation_payment_resolutions enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.customer_credits enable row level security;

revoke all on table public.cancellation_stock_resolutions from anon,authenticated;
revoke all on table public.cancellation_payment_resolutions from anon,authenticated;
revoke all on table public.payment_refunds from anon,authenticated;
revoke all on table public.customer_credits from anon,authenticated;
grant all on table public.cancellation_stock_resolutions to service_role;
grant all on table public.cancellation_payment_resolutions to service_role;
grant all on table public.payment_refunds to service_role;
grant all on table public.customer_credits to service_role;

drop policy if exists cancellation_stock_resolutions_no_direct_access on public.cancellation_stock_resolutions;
create policy cancellation_stock_resolutions_no_direct_access
  on public.cancellation_stock_resolutions for all to authenticated
  using (false) with check (false);

drop policy if exists cancellation_payment_resolutions_no_direct_access on public.cancellation_payment_resolutions;
create policy cancellation_payment_resolutions_no_direct_access
  on public.cancellation_payment_resolutions for all to authenticated
  using (false) with check (false);

drop policy if exists payment_refunds_no_direct_access on public.payment_refunds;
create policy payment_refunds_no_direct_access
  on public.payment_refunds for all to authenticated
  using (false) with check (false);

drop policy if exists customer_credits_no_direct_access on public.customer_credits;
create policy customer_credits_no_direct_access
  on public.customer_credits for all to authenticated
  using (false) with check (false);

create or replace function private.cancellation_stock_resolved_qty(p_reservation_id uuid)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(r.quantity),0)
  from public.cancellation_stock_resolutions r
  where r.reservation_id=p_reservation_id
$$;

create or replace function private.cancellation_payment_resolved_amount(p_payment_id uuid)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(r.amount),0)
  from public.cancellation_payment_resolutions r
  where r.payment_id=p_payment_id
$$;

create or replace function public.cancellation_adjustment_for_app(p_work_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  can_stock boolean;
  can_finance boolean;
  stock_items jsonb:='[]'::jsonb;
  payment_items jsonb:='[]'::jsonb;
  request_items jsonb:='[]'::jsonb;
  stock_blocked boolean:=false;
  finance_blocked boolean:=false;
  provider_blocked boolean:=false;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  select * into w from public.work_orders where id=p_work_order_id;
  if not found then raise exception 'work_order_not_found'; end if;

  can_stock:=private.has_permission('catalog.write') or private.has_permission('stock.consume_all');
  can_finance:=private.has_permission('finance.read');

  select exists(
    select 1
    from public.stock_reservations sr
    where sr.work_order_id=w.id
      and sr.consumed_qty>private.cancellation_stock_resolved_qty(sr.id)
  ) into stock_blocked;

  if can_stock then
    select coalesce(jsonb_agg(jsonb_build_object(
      'reservation_id',x.id,
      'catalog_item_id',x.catalog_item_id,
      'name',x.item_name,
      'sku',x.sku,
      'unit',x.unit,
      'consumed_qty',x.consumed_qty,
      'resolved_qty',x.resolved_qty,
      'unresolved_qty',greatest(0,x.consumed_qty-x.resolved_qty)
    ) order by x.item_name),'[]'::jsonb)
    into stock_items
    from (
      select sr.id,sr.catalog_item_id,ci.name as item_name,ci.sku,ci.unit,sr.consumed_qty,
        private.cancellation_stock_resolved_qty(sr.id) as resolved_qty
      from public.stock_reservations sr
      join public.catalog_items ci on ci.id=sr.catalog_item_id
      where sr.work_order_id=w.id and sr.consumed_qty>0
    ) x;
  end if;

  select exists(
    select 1
    from public.payments p
    where p.work_order_id=w.id
      and p.status in ('approved','partially_refunded')
      and p.amount>private.cancellation_payment_resolved_amount(p.id)
  ) into finance_blocked;

  select exists(
    select 1
    from public.payment_requests pr
    where pr.work_order_id=w.id and pr.status in ('pending','processing')
  ) into provider_blocked;

  if can_finance then
    select coalesce(jsonb_agg(jsonb_build_object(
      'payment_id',x.id,
      'provider',x.provider,
      'provider_payment_id',x.provider_payment_id,
      'method',x.method,
      'status',x.status,
      'amount',x.amount,
      'resolved_amount',x.resolved_amount,
      'unresolved_amount',greatest(0,x.amount-x.resolved_amount),
      'paid_at',x.paid_at
    ) order by x.paid_at nulls last,x.id),'[]'::jsonb)
    into payment_items
    from (
      select p.id,p.provider,p.provider_payment_id,p.method,p.status,p.amount,p.paid_at,
        private.cancellation_payment_resolved_amount(p.id) as resolved_amount
      from public.payments p
      where p.work_order_id=w.id
        and p.status in ('approved','partially_refunded','refunded')
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object(
      'request_id',pr.id,
      'provider',pr.provider,
      'provider_payment_id',pr.provider_payment_id,
      'method',pr.method,
      'status',pr.status,
      'amount',pr.amount,
      'expires_at',pr.expires_at
    ) order by pr.created_at),'[]'::jsonb)
    into request_items
    from public.payment_requests pr
    where pr.work_order_id=w.id and pr.status in ('pending','processing');
  end if;

  return jsonb_build_object(
    'work_order_id',w.id,
    'status',w.status,
    'stock',stock_items,
    'payments',payment_items,
    'active_payment_requests',request_items,
    'needs_stock_adjustment',stock_blocked,
    'needs_financial_adjustment',finance_blocked,
    'needs_provider_cancellation',provider_blocked,
    'can_adjust_stock',can_stock,
    'can_view_finance',can_finance,
    'can_adjust_finance',private.has_permission('finance.write'),
    'ready_to_cancel',not stock_blocked and not finance_blocked and not provider_blocked
  );
end
$$;

create or replace function public.resolve_cancellation_stock(
  p_work_order_id uuid,
  p_reservation_id uuid,
  p_action text,
  p_quantity numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  w public.work_orders;
  sr public.stock_reservations;
  already_resolved numeric;
  resolution_id uuid;
  movement_id uuid;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if not (private.has_permission('catalog.write') or private.has_permission('stock.consume_all')) then
    raise exception 'stock_adjustment_not_allowed' using errcode='42501';
  end if;
  if p_action not in ('return_to_stock','write_off','keep_installed') then
    raise exception 'invalid_stock_resolution';
  end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'invalid_quantity'; end if;

  select * into w from public.work_orders where id=p_work_order_id for update;
  if not found then raise exception 'work_order_not_found'; end if;
  if w.status in ('delivered','cancelled') then raise exception 'work_order_closed'; end if;

  select * into sr
  from public.stock_reservations
  where id=p_reservation_id and work_order_id=w.id
  for update;
  if not found then raise exception 'reservation_not_found'; end if;

  already_resolved:=private.cancellation_stock_resolved_qty(sr.id);
  if p_quantity>greatest(0,sr.consumed_qty-already_resolved) then
    raise exception 'quantity_exceeds_consumed_unresolved';
  end if;

  if p_action='return_to_stock' then
    insert into public.stock_movements(
      catalog_item_id,work_order_id,movement_type,quantity_delta,note,created_by
    )
    values(
      sr.catalog_item_id,w.id,'return',p_quantity,
      'Cancelamento · retorno ao estoque'||
        case when nullif(trim(coalesce(p_note,'')),'') is not null then ' · '||trim(p_note) else '' end,
      (select auth.uid())
    )
    returning id into movement_id;
  end if;

  insert into public.cancellation_stock_resolutions(
    work_order_id,reservation_id,action,quantity,note,created_by
  )
  values(
    w.id,sr.id,p_action,p_quantity,nullif(trim(coalesce(p_note,'')),''),(select auth.uid())
  )
  returning id into resolution_id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(
    w.id,(select auth.uid()),'user','cancellation_stock_resolved',
    jsonb_build_object(
      'resolution_id',resolution_id,
      'reservation_id',sr.id,
      'catalog_item_id',sr.catalog_item_id,
      'action',p_action,
      'quantity',p_quantity,
      'stock_movement_id',movement_id,
      'note',nullif(trim(coalesce(p_note,'')),'')
    )
  );

  return jsonb_build_object(
    'ok',true,
    'resolution_id',resolution_id,
    'remaining',greatest(0,sr.consumed_qty-already_resolved-p_quantity)
  );
end
$$;

create or replace function private.record_cancellation_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_provider text,
  p_provider_refund_id text,
  p_payload jsonb,
  p_note text,
  p_source text,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  p public.payments;
  refunded numeric;
  resolved numeric;
  refund_id uuid;
  resolution_id uuid;
begin
  select * into p from public.payments where id=p_payment_id for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.status not in ('approved','partially_refunded') then raise exception 'payment_not_refundable'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'invalid_amount'; end if;

  select coalesce(sum(pr.amount),0) into refunded
  from public.payment_refunds pr
  where pr.payment_id=p.id and pr.status='approved';

  resolved:=private.cancellation_payment_resolved_amount(p.id);

  if p_amount>greatest(0,p.amount-refunded) then raise exception 'refund_exceeds_payment'; end if;
  if p_amount>greatest(0,p.amount-resolved) then raise exception 'resolution_exceeds_payment'; end if;

  insert into public.payment_refunds(
    payment_id,work_order_id,provider,provider_refund_id,amount,status,payload,note,created_by
  )
  values(
    p.id,p.work_order_id,p_provider,nullif(trim(coalesce(p_provider_refund_id,'')),''),p_amount,
    'approved',coalesce(p_payload,'{}'::jsonb),nullif(trim(coalesce(p_note,'')),''),p_created_by
  )
  returning id into refund_id;

  insert into public.cancellation_payment_resolutions(
    work_order_id,payment_id,action,amount,note,source,created_by
  )
  values(
    p.work_order_id,p.id,'refund',p_amount,nullif(trim(coalesce(p_note,'')),''),
    case when p_source in ('provider','system') then p_source else 'user' end,p_created_by
  )
  returning id into resolution_id;

  insert into public.financial_transactions(
    work_order_id,direction,category,description,amount,status,settled_at,payment_method,internal_notes,created_by
  )
  values(
    p.work_order_id,'expense','Estorno de recebimento',
    case when p.provider='mercadopago' then 'Reembolso Mercado Pago' else 'Estorno de recebimento' end,
    p_amount,'paid',now(),p.method,
    'Acerto de cancelamento · pagamento '||p.id::text,
    p_created_by
  );

  select coalesce(sum(pr.amount),0) into refunded
  from public.payment_refunds pr
  where pr.payment_id=p.id and pr.status='approved';

  update public.payments
  set status=case when refunded>=p.amount then 'refunded' else 'partially_refunded' end,
      provider_status=case when refunded>=p.amount then 'refunded' else coalesce(provider_status,'partially_refunded') end,
      updated_at=now()
  where id=p.id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(
    p.work_order_id,p_created_by,'user','cancellation_payment_resolved',
    jsonb_build_object(
      'resolution_id',resolution_id,
      'payment_id',p.id,
      'action','refund',
      'amount',p_amount,
      'refund_id',refund_id,
      'provider_refund_id',p_provider_refund_id,
      'source',p_source
    )
  );

  return refund_id;
end
$$;

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
  credit_id uuid;
  refund_id uuid;
  customer_id uuid;
begin
  if not private.has_permission('work_orders.write_all') then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if not private.has_permission('finance.write') then
    raise exception 'finance_adjustment_not_allowed' using errcode='42501';
  end if;
  if p_action not in ('refund','credit_customer','keep_charged') then
    raise exception 'invalid_payment_resolution';
  end if;
  if p_amount is null or p_amount<=0 then raise exception 'invalid_amount'; end if;

  select * into w from public.work_orders where id=p_work_order_id for update;
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
      'ok',true,'action','refund','refund_id',refund_id,
      'remaining',greatest(0,p.amount-already_resolved-p_amount)
    );
  end if;

  insert into public.cancellation_payment_resolutions(
    work_order_id,payment_id,action,amount,note,source,created_by
  )
  values(
    w.id,p.id,p_action,p_amount,nullif(trim(coalesce(p_note,'')),''),'user',(select auth.uid())
  )
  returning id into resolution_id;

  if p_action='credit_customer' then
    select wo.customer_id into customer_id from public.work_orders wo where wo.id=w.id;

    insert into public.customer_credits(
      customer_id,source_work_order_id,source_payment_id,amount,status,note,created_by
    )
    values(
      customer_id,w.id,p.id,p_amount,'available',
      nullif(trim(coalesce(p_note,'')),''),(select auth.uid())
    )
    returning id into credit_id;
  end if;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(
    w.id,(select auth.uid()),'user','cancellation_payment_resolved',
    jsonb_build_object(
      'resolution_id',resolution_id,
      'payment_id',p.id,
      'action',p_action,
      'amount',p_amount,
      'credit_id',credit_id,
      'note',nullif(trim(coalesce(p_note,'')),'')
    )
  );

  return jsonb_build_object(
    'ok',true,
    'action',p_action,
    'resolution_id',resolution_id,
    'credit_id',credit_id,
    'remaining',greatest(0,p.amount-already_resolved-p_amount)
  );
end
$$;

create or replace function public.record_provider_cancellation_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_provider_refund_id text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
begin
  return private.record_cancellation_refund(
    p_payment_id,p_amount,'mercadopago',p_provider_refund_id,
    coalesce(p_payload,'{}'::jsonb),'Reembolso confirmado pelo Mercado Pago',
    'provider',null
  );
end
$$;

create or replace function private.sync_payment_financial_transaction()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status='approved' then
    insert into public.financial_transactions(
      work_order_id,payment_id,direction,category,description,amount,status,
      settled_at,payment_method,internal_notes,created_by
    )
    values(
      new.work_order_id,new.id,'income','Recebimento',
      case when new.provider='mercadopago' then 'Recebimento Mercado Pago' else 'Recebimento manual' end,
      new.amount,'paid',coalesce(new.paid_at,now()),new.method,null,null
    )
    on conflict (payment_id) where payment_id is not null do update
    set amount=excluded.amount,status='paid',settled_at=excluded.settled_at,
        payment_method=excluded.payment_method,description=excluded.description;
  elsif new.status='refunded' then
    update public.financial_transactions
    set status='refunded'
    where payment_id=new.id;
  elsif new.status='cancelled' then
    update public.financial_transactions
    set status='cancelled'
    where payment_id=new.id;
  elsif new.status='partially_refunded' then
    update public.financial_transactions
    set status='paid'
    where payment_id=new.id;
  end if;
  return new;
end
$$;

create or replace view public.work_order_financial_summary
with (security_invoker=true)
as
select
  w.id as work_order_id,
  coalesce((
    select sum(r.amount) from public.receivables r
    where r.work_order_id=w.id and r.status<>'cancelled'
  ),0) as receivable_total,
  greatest(0,
    coalesce((
      select sum(p.amount) from public.payments p
      where p.work_order_id=w.id
        and p.status in ('approved','partially_refunded','refunded')
    ),0)
    - coalesce((
      select sum(pr.amount) from public.payment_refunds pr
      where pr.work_order_id=w.id and pr.status='approved'
    ),0)
    - coalesce((
      select sum(cc.amount) from public.customer_credits cc
      where cc.source_work_order_id=w.id and cc.status<>'cancelled'
    ),0)
  ) as received_total,
  coalesce((
    select sum(ft.amount) from public.financial_transactions ft
    where ft.work_order_id=w.id
      and ft.direction='expense'
      and ft.status<>'cancelled'
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
  credited_total numeric:=0;
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

  select coalesce(sum(amount),0) into credited_total
  from public.cancellation_payment_resolutions
  where work_order_id=w.id and action='credit_customer';

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
      'refunded_amount',refunded_total,
      'credited_amount',credited_total
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
    'refunded_amount',refunded_total,
    'credited_amount',credited_total
  );
end
$$;

revoke all on function public.cancellation_adjustment_for_app(uuid) from public,anon;
revoke all on function public.resolve_cancellation_stock(uuid,uuid,text,numeric,text) from public,anon;
revoke all on function public.resolve_cancellation_payment(uuid,uuid,text,numeric,text) from public,anon;
revoke all on function public.record_provider_cancellation_refund(uuid,numeric,text,jsonb) from public,anon,authenticated;

grant execute on function public.cancellation_adjustment_for_app(uuid) to authenticated;
grant execute on function public.resolve_cancellation_stock(uuid,uuid,text,numeric,text) to authenticated;
grant execute on function public.resolve_cancellation_payment(uuid,uuid,text,numeric,text) to authenticated;
grant execute on function public.record_provider_cancellation_refund(uuid,numeric,text,jsonb) to service_role;
