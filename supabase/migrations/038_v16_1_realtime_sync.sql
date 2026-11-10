-- v16.1 realtime synchronization across devices
-- Only operational tables used by the app are added to the Supabase Realtime publication.

do $$
declare
  t text;
  realtime_tables text[] := array[
    'work_orders',
    'customers',
    'vehicles',
    'inspection_photos',
    'budget_revisions',
    'budget_items',
    'approvals',
    'catalog_items',
    'stock_reservations',
    'stock_movements',
    'purchases',
    'purchase_items',
    'receivables',
    'payments',
    'payment_requests',
    'financial_transactions',
    'activity_log'
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
