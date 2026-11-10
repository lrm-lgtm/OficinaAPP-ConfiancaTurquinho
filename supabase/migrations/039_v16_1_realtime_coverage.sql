-- v16.1 realtime coverage for finance, cancellation and access-control data.

do $$
declare
  t text;
  realtime_tables text[] := array[
    'catalog_item_costs',
    'suppliers',
    'payment_refunds',
    'cancellation_payment_resolutions',
    'cancellation_stock_resolutions',
    'provider_payment_adjustment_requests',
    'permission_catalog',
    'staff_profiles',
    'role_permissions',
    'staff_permission_overrides'
  ];
begin
  foreach t in array realtime_tables loop
    if to_regclass(format('public.%I',t)) is not null
       and not exists(
         select 1
         from pg_publication_tables
         where pubname='supabase_realtime'
           and schemaname='public'
           and tablename=t
       ) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end
$$;
