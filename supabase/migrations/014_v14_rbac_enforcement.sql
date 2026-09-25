-- v14.0 RBAC enforcement
create table if not exists public.role_permissions (
  role text not null check (role in ('owner','manager','reception','mechanic','finance')),
  permission text not null,
  enabled boolean not null default true,
  primary key (role, permission)
);

create table if not exists public.staff_permission_overrides (
  user_id uuid not null references public.staff_profiles(id) on delete cascade,
  permission text not null,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, permission)
);

alter table public.role_permissions enable row level security;
alter table public.staff_permission_overrides enable row level security;

insert into public.role_permissions(role,permission,enabled) values
('owner','*',true),
('manager','customers.read',true),('manager','customers.write',true),
('manager','work_orders.read_all',true),('manager','work_orders.write_all',true),
('manager','inspections.read_all',true),('manager','inspections.write_all',true),
('manager','budgets.read',true),('manager','budgets.write',true),('manager','budgets.send',true),
('manager','catalog.read',true),('manager','catalog.write',true),
('manager','finance.read',true),('manager','finance.write',true),
('manager','activity.read_all',true),('manager','team.read',true),
('reception','customers.read',true),('reception','customers.write',true),
('reception','work_orders.read_all',true),('reception','work_orders.write_all',true),
('reception','inspections.read_all',true),('reception','inspections.write_all',true),
('reception','budgets.read',true),('reception','budgets.write',true),('reception','budgets.send',true),
('reception','catalog.read',true),('reception','activity.read_all',true),
('mechanic','work_orders.read_assigned',true),('mechanic','work_orders.write_assigned',true),
('mechanic','inspections.read_assigned',true),('mechanic','inspections.write_assigned',true),
('mechanic','activity.read_assigned',true),
('finance','customers.read',true),('finance','work_orders.read_all',true),
('finance','budgets.read',true),('finance','catalog.read',true),
('finance','finance.read',true),('finance','finance.write',true),('finance','activity.read_all',true)
on conflict (role,permission) do update set enabled=excluded.enabled;

create or replace function private.current_staff_role()
returns text language sql stable security definer set search_path=''
as $$ select sp.role from public.staff_profiles sp where sp.id=(select auth.uid()) and sp.active=true limit 1 $$;

create or replace function private.has_permission(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$
  select case
    when not exists(select 1 from public.staff_profiles sp where sp.id=(select auth.uid()) and sp.active=true) then false
    when exists(select 1 from public.staff_permission_overrides o where o.user_id=(select auth.uid()) and o.permission=p_permission)
      then (select o.enabled from public.staff_permission_overrides o where o.user_id=(select auth.uid()) and o.permission=p_permission limit 1)
    when exists(
      select 1 from public.staff_profiles sp
      join public.role_permissions rp on rp.role=sp.role
      where sp.id=(select auth.uid()) and sp.active=true and rp.permission='*' and rp.enabled=true
    ) then true
    else exists(
      select 1 from public.staff_profiles sp
      join public.role_permissions rp on rp.role=sp.role
      where sp.id=(select auth.uid()) and sp.active=true and rp.permission=p_permission and rp.enabled=true
    )
  end
$$;

create or replace function private.can_access_work_order(p_work_order_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=''
as $$
  select case
    when p_write and private.has_permission('work_orders.write_all') then true
    when not p_write and private.has_permission('work_orders.read_all') then true
    when p_write and private.has_permission('work_orders.write_assigned') then exists(
      select 1 from public.work_orders w where w.id=p_work_order_id and w.assigned_to=(select auth.uid())
    )
    when not p_write and private.has_permission('work_orders.read_assigned') then exists(
      select 1 from public.work_orders w where w.id=p_work_order_id and w.assigned_to=(select auth.uid())
    )
    else false
  end
$$;

create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path=''
as $$
  select case
    when private.current_staff_role()='owner' then array['*']::text[]
    else coalesce(array(
      select distinct p.permission
      from (
        select rp.permission
        from public.staff_profiles sp
        join public.role_permissions rp on rp.role=sp.role and rp.enabled=true
        where sp.id=(select auth.uid()) and sp.active=true
        union
        select o.permission from public.staff_permission_overrides o
        where o.user_id=(select auth.uid()) and o.enabled=true
      ) p
      where not exists(
        select 1 from public.staff_permission_overrides x
        where x.user_id=(select auth.uid()) and x.permission=p.permission and x.enabled=false
      )
    ),array[]::text[])
  end
$$;

revoke all on function private.current_staff_role() from public,anon;
revoke all on function private.has_permission(text) from public,anon;
revoke all on function private.can_access_work_order(uuid,boolean) from public,anon;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.can_access_work_order(uuid,boolean) to authenticated;
revoke all on function public.my_permissions() from public,anon;
grant execute on function public.my_permissions() to authenticated;

drop policy if exists role_permissions_read on public.role_permissions;
drop policy if exists role_permissions_write on public.role_permissions;
create policy role_permissions_read on public.role_permissions for select to authenticated using (private.has_permission('team.read'));
create policy role_permissions_write on public.role_permissions for all to authenticated using (private.has_permission('team.manage')) with check (private.has_permission('team.manage'));

drop policy if exists staff_permission_overrides_read on public.staff_permission_overrides;
drop policy if exists staff_permission_overrides_write on public.staff_permission_overrides;
create policy staff_permission_overrides_read on public.staff_permission_overrides for select to authenticated using (user_id=(select auth.uid()) or private.has_permission('team.read'));
create policy staff_permission_overrides_write on public.staff_permission_overrides for all to authenticated using (private.has_permission('team.manage')) with check (private.has_permission('team.manage'));

drop policy if exists staff_read_self on public.staff_profiles;
drop policy if exists staff_read_team on public.staff_profiles;
drop policy if exists staff_manage on public.staff_profiles;
create policy staff_read_team on public.staff_profiles for select to authenticated using (id=(select auth.uid()) or private.has_permission('team.read'));
create policy staff_manage on public.staff_profiles for update to authenticated using (private.has_permission('team.manage')) with check (private.has_permission('team.manage'));

drop policy if exists active_staff_all on public.customers;
create policy customers_read on public.customers for select to authenticated using (private.has_permission('customers.read'));
create policy customers_insert on public.customers for insert to authenticated with check (private.has_permission('customers.write'));
create policy customers_update on public.customers for update to authenticated using (private.has_permission('customers.write')) with check (private.has_permission('customers.write'));

drop policy if exists active_staff_all on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated using (private.has_permission('customers.read'));
create policy vehicles_insert on public.vehicles for insert to authenticated with check (private.has_permission('customers.write'));
create policy vehicles_update on public.vehicles for update to authenticated using (private.has_permission('customers.write')) with check (private.has_permission('customers.write'));

drop policy if exists active_staff_all on public.work_orders;
create policy work_orders_read on public.work_orders for select to authenticated using (private.can_access_work_order(id,false));
create policy work_orders_insert on public.work_orders for insert to authenticated with check (private.has_permission('work_orders.write_all'));
create policy work_orders_update on public.work_orders for update to authenticated using (private.can_access_work_order(id,true)) with check (private.can_access_work_order(id,true));

drop policy if exists active_staff_all on public.inspection_photos;
create policy inspection_read on public.inspection_photos for select to authenticated using (
  private.has_permission('inspections.read_all') or (private.has_permission('inspections.read_assigned') and private.can_access_work_order(work_order_id,false))
);
create policy inspection_insert on public.inspection_photos for insert to authenticated with check (
  private.has_permission('inspections.write_all') or (private.has_permission('inspections.write_assigned') and private.can_access_work_order(work_order_id,true))
);
create policy inspection_update on public.inspection_photos for update to authenticated using (
  private.has_permission('inspections.write_all') or (private.has_permission('inspections.write_assigned') and private.can_access_work_order(work_order_id,true))
) with check (
  private.has_permission('inspections.write_all') or (private.has_permission('inspections.write_assigned') and private.can_access_work_order(work_order_id,true))
);

drop policy if exists active_staff_all on public.budget_revisions;
create policy budget_revisions_read on public.budget_revisions for select to authenticated using (private.has_permission('budgets.read'));
create policy budget_revisions_insert on public.budget_revisions for insert to authenticated with check (private.has_permission('budgets.write'));
create policy budget_revisions_update on public.budget_revisions for update to authenticated using (private.has_permission('budgets.write')) with check (private.has_permission('budgets.write'));

drop policy if exists active_staff_all on public.budget_items;
create policy budget_items_read on public.budget_items for select to authenticated using (private.has_permission('budgets.read'));
create policy budget_items_insert on public.budget_items for insert to authenticated with check (private.has_permission('budgets.write'));
create policy budget_items_update on public.budget_items for update to authenticated using (private.has_permission('budgets.write')) with check (private.has_permission('budgets.write'));
create policy budget_items_delete on public.budget_items for delete to authenticated using (private.has_permission('budgets.write'));

drop policy if exists active_staff_all on public.approval_tokens;
create policy approval_tokens_read on public.approval_tokens for select to authenticated using (private.has_permission('budgets.read'));
create policy approval_tokens_insert on public.approval_tokens for insert to authenticated with check (private.has_permission('budgets.send'));
create policy approval_tokens_update on public.approval_tokens for update to authenticated using (private.has_permission('budgets.send')) with check (private.has_permission('budgets.send'));

drop policy if exists active_staff_all on public.approvals;
create policy approvals_read on public.approvals for select to authenticated using (private.has_permission('budgets.read'));

drop policy if exists active_staff_all on public.activity_log;
create policy activity_read on public.activity_log for select to authenticated using (
  private.has_permission('activity.read_all') or (
    private.has_permission('activity.read_assigned') and work_order_id is not null and private.can_access_work_order(work_order_id,false)
  )
);
create policy activity_insert on public.activity_log for insert to authenticated with check (work_order_id is null or private.can_access_work_order(work_order_id,false));

drop policy if exists active_staff_all on public.catalog_items;
create policy catalog_read on public.catalog_items for select to authenticated using (private.has_permission('catalog.read'));
create policy catalog_insert on public.catalog_items for insert to authenticated with check (private.has_permission('catalog.write'));
create policy catalog_update on public.catalog_items for update to authenticated using (private.has_permission('catalog.write')) with check (private.has_permission('catalog.write'));

do $$
declare t text;
begin
  foreach t in array array['suppliers','purchases','purchase_items','financial_transactions','receivables','payments']
  loop
    execute format('drop policy if exists active_staff_all on public.%I',t);
    execute format('drop policy if exists finance_read on public.%I',t);
    execute format('drop policy if exists finance_insert on public.%I',t);
    execute format('drop policy if exists finance_update on public.%I',t);
    execute format('create policy finance_read on public.%I for select to authenticated using (private.has_permission(''finance.read''))',t);
    execute format('create policy finance_insert on public.%I for insert to authenticated with check (private.has_permission(''finance.write''))',t);
    execute format('create policy finance_update on public.%I for update to authenticated using (private.has_permission(''finance.write'')) with check (private.has_permission(''finance.write''))',t);
  end loop;
end $$;

drop policy if exists active_staff_all on public.payment_requests;
create policy payment_requests_read on public.payment_requests for select to authenticated using (private.has_permission('finance.read'));
drop policy if exists active_staff_all on public.payment_webhook_events;

create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.staff_profiles sp where sp.id=(select auth.uid()) and sp.active=true) $$;
revoke all on function private.is_active_staff() from public,anon;
grant execute on function private.is_active_staff() to authenticated;
