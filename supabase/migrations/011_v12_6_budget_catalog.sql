-- v12.6 reusable parts/services catalog for practical budget entry
create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'part' check (kind in ('part','service','other')),
  name text not null,
  sku text,
  unit text not null default 'un',
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  track_stock boolean not null default false,
  stock_qty numeric(12,3) not null default 0,
  favorite boolean not null default false,
  active boolean not null default true,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_items_kind_name_uq
  on public.catalog_items(kind, lower(name));

create index if not exists catalog_items_active_kind_idx
  on public.catalog_items(active, kind);

alter table public.budget_items
  add column if not exists catalog_item_id uuid references public.catalog_items(id) on delete set null;

create index if not exists budget_items_catalog_item_id_idx
  on public.budget_items(catalog_item_id);

alter table public.catalog_items enable row level security;

drop policy if exists active_staff_all on public.catalog_items;
create policy active_staff_all
  on public.catalog_items
  for all
  to authenticated
  using (private.is_active_staff())
  with check (private.is_active_staff());

insert into public.catalog_items(kind,name,unit,sale_price,usage_count,last_used_at)
select x.kind,x.description,'un',x.unit_price,x.usage_count,x.last_used_at
from (
  select distinct on (bi.kind, lower(bi.description))
    bi.kind,
    bi.description,
    bi.unit_price,
    count(*) over (partition by bi.kind, lower(bi.description))::int as usage_count,
    max(br.created_at) over (partition by bi.kind, lower(bi.description)) as last_used_at,
    br.created_at
  from public.budget_items bi
  join public.budget_revisions br on br.id=bi.budget_revision_id
  where nullif(trim(bi.description),'') is not null
  order by bi.kind, lower(bi.description), br.created_at desc
) x
on conflict (kind, lower(name)) do update
set sale_price=excluded.sale_price,
    usage_count=greatest(public.catalog_items.usage_count, excluded.usage_count),
    last_used_at=greatest(public.catalog_items.last_used_at, excluded.last_used_at),
    updated_at=now();
