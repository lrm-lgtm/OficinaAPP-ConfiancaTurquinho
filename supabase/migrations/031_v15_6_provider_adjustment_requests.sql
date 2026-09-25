-- v15.6 provider adjustment request/idempotency ledger

create table if not exists public.provider_payment_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete cascade,
  payment_request_id uuid references public.payment_requests(id) on delete cascade,
  provider text not null default 'mercadopago',
  action text not null check (action in ('refund','cancel_pending')),
  amount numeric(12,2),
  status text not null default 'processing'
    check (status in ('processing','approved','provider_error','cancelled')),
  provider_reference text,
  provider_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provider_payment_adjustment_requests_payment_idx
  on public.provider_payment_adjustment_requests(payment_id,action,created_at desc);
create index if not exists provider_payment_adjustment_requests_request_idx
  on public.provider_payment_adjustment_requests(payment_request_id,action,created_at desc);

drop trigger if exists provider_payment_adjustment_requests_set_updated_at
  on public.provider_payment_adjustment_requests;
create trigger provider_payment_adjustment_requests_set_updated_at
before update on public.provider_payment_adjustment_requests
for each row execute function public.set_updated_at();

alter table public.provider_payment_adjustment_requests enable row level security;
revoke all on table public.provider_payment_adjustment_requests from anon,authenticated;
grant all on table public.provider_payment_adjustment_requests to service_role;

drop policy if exists provider_payment_adjustment_requests_no_direct_access
  on public.provider_payment_adjustment_requests;
create policy provider_payment_adjustment_requests_no_direct_access
  on public.provider_payment_adjustment_requests for all to authenticated
  using (false) with check (false);
