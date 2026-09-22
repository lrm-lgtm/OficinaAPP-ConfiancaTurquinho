-- v11.4.2 compatibility RPC for deployed protected payment function
-- SECURITY INVOKER, authenticated-only. Safe compatibility wrapper while payment function v1 calls RPC.

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists(
    select 1
    from public.staff_profiles sp
    where sp.id = (select auth.uid())
      and sp.active = true
  );
$$;

revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated;
