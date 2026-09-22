-- v11.2 Finance core: internal costs, purchases, receipts and payments.
-- These tables are internal-only. Public customer approval functions must not expose them.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_id text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  work_order_id uuid references public.work_orders(id) on delete set null,
  invoice_number text,
  purchased_at timestamptz not null default now(),
  total numeric(12,2) not null default 0 check (total >= 0),
  payment_status text not null default 'open'
    check (payment_status in ('open','partial','paid','cancelled')),
  receipt_storage_path text,
  receipt_mime text,
  extraction_status text not null default 'not_requested'
    check (extraction_status in ('not_requested','pending','review','confirmed','failed')),
  extracted_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  line_cost numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  linked_budget_item_id uuid references public.budget_items(id) on delete set null
);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.work_orders(id) on delete set null,
  purchase_id uuid references public.purchases(id) on delete set null,
  direction text not null check (direction in ('income','expense')),
  category text not null,
  description text not null,
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'open'
    check (status in ('open','partial','paid','overdue','cancelled','refunded')),
  due_at timestamptz,
  settled_at timestamptz,
  payment_method text,
  internal_notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  budget_revision_id uuid references public.budget_revisions(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'open'
    check (status in ('open','partial','paid','overdue','cancelled')),
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  receivable_id uuid references public.receivables(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  provider text not null default 'manual',
  provider_payment_id text,
  provider_status text,
  amount numeric(12,2) not null check (amount >= 0),
  method text,
  status text not null default 'pending'
    check (status in ('pending','processing','approved','rejected','cancelled','refunded','partially_refunded')),
  paid_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists payments_provider_unique on public.payments(provider, provider_payment_id) where provider_payment_id is not null;
create index if not exists purchases_supplier_idx on public.purchases(supplier_id);
create index if not exists purchases_work_order_idx on public.purchases(work_order_id);
create index if not exists purchase_items_purchase_idx on public.purchase_items(purchase_id);
create index if not exists financial_transactions_work_order_idx on public.financial_transactions(work_order_id);
create index if not exists receivables_work_order_idx on public.receivables(work_order_id);
create index if not exists payments_receivable_idx on public.payments(receivable_id);
create index if not exists payments_work_order_idx on public.payments(work_order_id);

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();

drop trigger if exists purchases_set_updated_at on public.purchases;
create trigger purchases_set_updated_at before update on public.purchases for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.receivables enable row level security;
alter table public.payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['suppliers','purchases','purchase_items','financial_transactions','receivables','payments']
  loop
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

create or replace view public.work_order_financial_summary
with (security_invoker=true)
as
select
  w.id as work_order_id,
  coalesce((select sum(r.amount) from public.receivables r where r.work_order_id=w.id and r.status <> 'cancelled'),0) as receivable_total,
  coalesce((select sum(p.amount) from public.payments p where p.work_order_id=w.id and p.status='approved'),0) as received_total,
  coalesce((select sum(ft.amount) from public.financial_transactions ft where ft.work_order_id=w.id and ft.direction='expense' and ft.status <> 'cancelled'),0) as expense_total,
  coalesce((select sum(pi.line_cost)
    from public.purchase_items pi
    join public.purchases pu on pu.id=pi.purchase_id
    where pu.work_order_id=w.id and pu.payment_status <> 'cancelled'),0) as purchase_cost_total
from public.work_orders w;

grant select on public.work_order_financial_summary to authenticated;
