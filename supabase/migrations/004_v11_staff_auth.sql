-- v11.3 Staff authorization / role gate

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'mechanic'
    check (role in ('owner','manager','reception','mechanic','finance')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists staff_profiles_set_updated_at on public.staff_profiles;
create trigger staff_profiles_set_updated_at before update on public.staff_profiles
for each row execute function public.set_updated_at();

alter table public.staff_profiles enable row level security;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.staff_profiles sp
    where sp.id = auth.uid()
      and sp.active = true
  );
$$;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.id = auth.uid()
    and sp.active = true
  limit 1;
$$;

revoke all on function public.is_active_staff() from public;
revoke all on function public.current_staff_role() from public;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.current_staff_role() to authenticated;

drop policy if exists staff_read_self on public.staff_profiles;
create policy staff_read_self
on public.staff_profiles for select to authenticated
using (id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','vehicles','work_orders','inspection_photos',
    'budget_revisions','budget_items','approval_tokens','approvals','activity_log',
    'suppliers','purchases','purchase_items','financial_transactions','receivables','payments'
  ]
  loop
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('drop policy if exists active_staff_all on public.%I', t);
    execute format(
      'create policy active_staff_all on public.%I for all to authenticated using (public.is_active_staff()) with check (public.is_active_staff())',
      t
    );
  end loop;
end $$;

drop policy if exists "authenticated evidence read" on storage.objects;
drop policy if exists "authenticated evidence write" on storage.objects;
drop policy if exists "authenticated evidence update" on storage.objects;
drop policy if exists "active staff evidence read" on storage.objects;
drop policy if exists "active staff evidence write" on storage.objects;
drop policy if exists "active staff evidence update" on storage.objects;

create policy "active staff evidence read"
on storage.objects for select to authenticated
using (bucket_id='oficina-evidence' and public.is_active_staff());

create policy "active staff evidence write"
on storage.objects for insert to authenticated
with check (bucket_id='oficina-evidence' and public.is_active_staff());

create policy "active staff evidence update"
on storage.objects for update to authenticated
using (bucket_id='oficina-evidence' and public.is_active_staff())
with check (bucket_id='oficina-evidence' and public.is_active_staff());
