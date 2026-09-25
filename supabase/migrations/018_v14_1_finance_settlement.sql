-- v14.1 finance settlement and payment linkage
alter table public.financial_transactions
  add column if not exists payment_id uuid references public.payments(id) on delete set null;

create unique index if not exists financial_transactions_payment_id_uq
  on public.financial_transactions(payment_id)
  where payment_id is not null;

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
  elsif new.status in ('refunded','partially_refunded','cancelled') then
    update public.financial_transactions
    set status=case when new.status in ('refunded','partially_refunded') then 'refunded' else 'cancelled' end
    where payment_id=new.id;
  end if;
  return new;
end
$$;

drop trigger if exists payments_sync_financial_transaction on public.payments;
create trigger payments_sync_financial_transaction
after insert or update of status,amount,paid_at,method on public.payments
for each row execute function private.sync_payment_financial_transaction();

create or replace function public.record_manual_payment(
  p_receivable_id uuid,p_amount numeric,p_method text,p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare r public.receivables; new_payment_id uuid; remaining numeric; new_paid numeric;
begin
  if not private.has_permission('finance.write') then raise exception 'not_allowed' using errcode='42501'; end if;
  select * into r from public.receivables where id=p_receivable_id for update;
  if not found then raise exception 'receivable_not_found'; end if;
  if r.status in ('paid','cancelled') then raise exception 'receivable_closed'; end if;

  remaining:=greatest(0,r.amount-r.paid_amount);
  if p_amount is null or p_amount<=0 or p_amount>remaining then raise exception 'invalid_amount'; end if;

  insert into public.payments(receivable_id,work_order_id,provider,amount,method,status,paid_at,payload)
  values(r.id,r.work_order_id,'manual',p_amount,nullif(trim(p_method),''),'approved',now(),
    jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''))
  ) returning id into new_payment_id;

  new_paid:=r.paid_amount+p_amount;
  update public.receivables
  set paid_amount=new_paid,status=case when new_paid>=r.amount then 'paid' else 'partial' end
  where id=r.id;

  insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
  values(r.work_order_id,(select auth.uid()),'user','manual_payment_recorded',
    jsonb_build_object('receivable_id',r.id,'payment_id',new_payment_id,'amount',p_amount,'method',p_method));

  return new_payment_id;
end
$$;

create or replace function public.settle_expense(
  p_transaction_id uuid,p_method text,p_settled_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare tx public.financial_transactions;
begin
  if not private.has_permission('finance.write') then raise exception 'not_allowed' using errcode='42501'; end if;

  select * into tx from public.financial_transactions
  where id=p_transaction_id and direction='expense' for update;
  if not found then raise exception 'expense_not_found'; end if;
  if tx.status in ('cancelled','refunded') then raise exception 'expense_closed'; end if;

  update public.financial_transactions
  set status='paid',settled_at=coalesce(p_settled_at,now()),payment_method=nullif(trim(p_method),'')
  where id=tx.id;

  if tx.purchase_id is not null then
    update public.purchases set payment_status='paid',updated_at=now() where id=tx.purchase_id;
  end if;

  if tx.work_order_id is not null then
    insert into public.activity_log(work_order_id,actor_user_id,actor_type,event_type,payload)
    values(tx.work_order_id,(select auth.uid()),'user','expense_settled',
      jsonb_build_object('transaction_id',tx.id,'amount',tx.amount,'method',p_method));
  end if;

  return tx.id;
end
$$;

revoke all on function public.record_manual_payment(uuid,numeric,text,text) from public,anon;
revoke all on function public.settle_expense(uuid,text,timestamptz) from public,anon;
grant execute on function public.record_manual_payment(uuid,numeric,text,text) to authenticated;
grant execute on function public.settle_expense(uuid,text,timestamptz) to authenticated;
