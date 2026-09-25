-- v15.7 canonical validation for Mercado Pago Pix requests
-- Keeps the deployed payment function safe even when the browser submits compatibility fields.

create or replace function private.user_has_permission(
  p_user_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when not exists(
      select 1 from public.staff_profiles sp
      where sp.id=p_user_id and sp.active=true
    ) then false

    when exists(
      select 1 from public.staff_permission_overrides o
      where o.user_id=p_user_id
        and o.permission=p_permission
        and o.enabled=false
    ) then false

    when exists(
      select 1 from public.staff_profiles sp
      where sp.id=p_user_id and sp.active=true and sp.role='owner'
    ) then true

    when exists(
      select 1 from public.staff_permission_overrides o
      where o.user_id=p_user_id
        and o.permission=p_permission
        and o.enabled=true
    ) then true

    when exists(
      select 1
      from public.staff_profiles sp
      join public.role_permissions rp on rp.role=sp.role
      where sp.id=p_user_id
        and sp.active=true
        and rp.enabled=true
        and rp.permission in ('*',p_permission)
    ) then true

    else false
  end
$$;

create or replace function private.validate_mercadopago_pix_request()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  br public.budget_revisions;
  recv public.receivables;
  remaining numeric;
begin
  if new.provider<>'mercadopago' or new.method<>'pix' then
    return new;
  end if;

  if new.created_by is null
     or not private.user_has_permission(new.created_by,'finance.write') then
    raise exception 'finance_write_required' using errcode='42501';
  end if;

  if new.budget_revision_id is null or new.receivable_id is null then
    raise exception 'pix_requires_approved_receivable';
  end if;

  select * into br
  from public.budget_revisions
  where id=new.budget_revision_id;

  if not found then raise exception 'budget_not_found'; end if;
  if br.status<>'approved' then raise exception 'budget_not_approved'; end if;

  select * into recv
  from public.receivables
  where id=new.receivable_id
  for update;

  if not found then raise exception 'receivable_not_found'; end if;
  if recv.budget_revision_id is distinct from br.id
     or recv.work_order_id is distinct from br.work_order_id
     or new.work_order_id is distinct from br.work_order_id then
    raise exception 'pix_payment_linkage_mismatch';
  end if;

  if recv.status in ('paid','cancelled') then
    raise exception 'receivable_closed';
  end if;

  remaining:=greatest(0,recv.amount-recv.paid_amount);
  if remaining<=0 then raise exception 'receivable_already_paid'; end if;

  if round(new.amount,2)<>round(remaining,2) then
    raise exception 'pix_amount_must_equal_receivable_balance';
  end if;

  if new.status<>'draft' then
    raise exception 'pix_request_must_start_as_draft';
  end if;

  return new;
end
$$;

drop trigger if exists validate_mercadopago_pix_request
  on public.payment_requests;

create trigger validate_mercadopago_pix_request
before insert on public.payment_requests
for each row
execute function private.validate_mercadopago_pix_request();

revoke all on function private.user_has_permission(uuid,text) from public,anon,authenticated;
revoke all on function private.validate_mercadopago_pix_request() from public,anon,authenticated;
grant execute on function private.user_has_permission(uuid,text) to service_role;
grant execute on function private.validate_mercadopago_pix_request() to service_role;
