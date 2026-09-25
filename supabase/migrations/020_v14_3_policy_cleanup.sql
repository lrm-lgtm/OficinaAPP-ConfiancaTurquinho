-- v14.3 policy/performance cleanup

-- Avoid duplicate permissive SELECT policies by separating write actions.
drop policy if exists role_permissions_write on public.role_permissions;
drop policy if exists role_permissions_insert on public.role_permissions;
drop policy if exists role_permissions_update on public.role_permissions;
drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
with check (private.has_permission('team.manage'));
create policy role_permissions_update on public.role_permissions for update to authenticated
using (private.has_permission('team.manage'))
with check (private.has_permission('team.manage'));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
using (private.has_permission('team.manage'));

drop policy if exists staff_permission_overrides_write on public.staff_permission_overrides;
drop policy if exists staff_permission_overrides_insert on public.staff_permission_overrides;
drop policy if exists staff_permission_overrides_update on public.staff_permission_overrides;
drop policy if exists staff_permission_overrides_delete on public.staff_permission_overrides;
create policy staff_permission_overrides_insert on public.staff_permission_overrides for insert to authenticated
with check (private.has_permission('team.manage'));
create policy staff_permission_overrides_update on public.staff_permission_overrides for update to authenticated
using (private.has_permission('team.manage'))
with check (private.has_permission('team.manage'));
create policy staff_permission_overrides_delete on public.staff_permission_overrides for delete to authenticated
using (private.has_permission('team.manage'));

drop policy if exists permission_catalog_write on public.permission_catalog;
drop policy if exists permission_catalog_insert on public.permission_catalog;
drop policy if exists permission_catalog_update on public.permission_catalog;
drop policy if exists permission_catalog_delete on public.permission_catalog;
create policy permission_catalog_insert on public.permission_catalog for insert to authenticated
with check (private.has_permission('team.manage'));
create policy permission_catalog_update on public.permission_catalog for update to authenticated
using (private.has_permission('team.manage'))
with check (private.has_permission('team.manage'));
create policy permission_catalog_delete on public.permission_catalog for delete to authenticated
using (private.has_permission('team.manage'));

drop policy if exists catalog_costs_write on public.catalog_item_costs;
drop policy if exists catalog_costs_insert on public.catalog_item_costs;
drop policy if exists catalog_costs_update on public.catalog_item_costs;
create policy catalog_costs_insert on public.catalog_item_costs for insert to authenticated
with check (private.has_permission('finance.write'));
create policy catalog_costs_update on public.catalog_item_costs for update to authenticated
using (private.has_permission('finance.write'))
with check (private.has_permission('finance.write'));

create index if not exists staff_invites_invited_by_idx on private.staff_invites(invited_by);
create index if not exists staff_invites_accepted_user_id_idx on private.staff_invites(accepted_user_id);
create index if not exists catalog_items_created_by_idx on public.catalog_items(created_by);
create index if not exists stock_movements_created_by_idx on public.stock_movements(created_by);
