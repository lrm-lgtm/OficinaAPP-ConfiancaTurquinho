-- v11.4.1 Security hardening after Supabase advisors

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_active_staff()
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

create or replace function private.current_staff_role()
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

revoke all on function private.is_active_staff() from public, anon;
revoke all on function private.current_staff_role() from public, anon;
grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.current_staff_role() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','vehicles','work_orders','inspection_photos',
    'budget_revisions','budget_items','approval_tokens','approvals','activity_log',
    'suppliers','purchases','purchase_items','financial_transactions','receivables','payments',
    'payment_requests','payment_webhook_events'
  ]
  loop
    execute format('drop policy if exists active_staff_all on public.%I', t);
    execute format(
      'create policy active_staff_all on public.%I for all to authenticated using (private.is_active_staff()) with check (private.is_active_staff())',
      t
    );
  end loop;
end $$;

drop policy if exists staff_read_self on public.staff_profiles;
create policy staff_read_self
on public.staff_profiles for select to authenticated
using (id = (select auth.uid()));

drop policy if exists "active staff evidence read" on storage.objects;
drop policy if exists "active staff evidence write" on storage.objects;
drop policy if exists "active staff evidence update" on storage.objects;

create policy "active staff evidence read"
on storage.objects for select to authenticated
using (bucket_id='oficina-evidence' and private.is_active_staff());

create policy "active staff evidence write"
on storage.objects for insert to authenticated
with check (bucket_id='oficina-evidence' and private.is_active_staff());

create policy "active staff evidence update"
on storage.objects for update to authenticated
using (bucket_id='oficina-evidence' and private.is_active_staff())
with check (bucket_id='oficina-evidence' and private.is_active_staff());

revoke all on function public.handle_new_staff_user() from public, anon, authenticated;
revoke all on function public.is_active_staff() from public, anon, authenticated;
revoke all on function public.current_staff_role() from public, anon, authenticated;

drop function if exists public.is_active_staff();
drop function if exists public.current_staff_role();

create index if not exists financial_transactions_created_by_idx on public.financial_transactions(created_by);
create index if not exists financial_transactions_purchase_id_idx on public.financial_transactions(purchase_id);
create index if not exists payment_requests_budget_revision_id_idx on public.payment_requests(budget_revision_id);
create index if not exists payment_requests_created_by_idx on public.payment_requests(created_by);
create index if not exists purchase_items_linked_budget_item_id_idx on public.purchase_items(linked_budget_item_id);
create index if not exists purchases_created_by_idx on public.purchases(created_by);
create index if not exists receivables_budget_revision_id_idx on public.receivables(budget_revision_id);
