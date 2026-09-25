-- v14.0 evidence storage RBAC
create or replace function private.can_access_evidence(p_name text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare first_part text; work_order_id uuid;
begin
  first_part:=split_part(coalesce(p_name,''),'/',1);

  if first_part='finance' then
    if p_write then return private.has_permission('finance.write'); end if;
    return private.has_permission('finance.read');
  end if;

  if first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  work_order_id:=first_part::uuid;

  if p_write then
    return private.has_permission('inspections.write_all')
      or (private.has_permission('inspections.write_assigned') and private.can_access_work_order(work_order_id,true));
  end if;

  return private.has_permission('inspections.read_all')
    or (private.has_permission('inspections.read_assigned') and private.can_access_work_order(work_order_id,false));
end
$$;

revoke all on function private.can_access_evidence(text,boolean) from public,anon;
grant execute on function private.can_access_evidence(text,boolean) to authenticated;

drop policy if exists "active staff evidence read" on storage.objects;
drop policy if exists "active staff evidence write" on storage.objects;
drop policy if exists "active staff evidence update" on storage.objects;
drop policy if exists "rbac evidence read" on storage.objects;
drop policy if exists "rbac evidence write" on storage.objects;
drop policy if exists "rbac evidence update" on storage.objects;

create policy "rbac evidence read" on storage.objects for select to authenticated
using (bucket_id='oficina-evidence' and private.can_access_evidence(name,false));

create policy "rbac evidence write" on storage.objects for insert to authenticated
with check (bucket_id='oficina-evidence' and private.can_access_evidence(name,true));

create policy "rbac evidence update" on storage.objects for update to authenticated
using (bucket_id='oficina-evidence' and private.can_access_evidence(name,true))
with check (bucket_id='oficina-evidence' and private.can_access_evidence(name,true));
