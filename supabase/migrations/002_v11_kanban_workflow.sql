-- v11.1 Kanban workflow / operational health

alter table public.work_orders
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists customer_promised_at timestamptz,
  add column if not exists internal_target_at timestamptz,
  add column if not exists forecast_at timestamptz,
  add column if not exists operational_state text not null default 'active'
    check (operational_state in ('active','waiting_parts','waiting_customer','third_party','technical_difficulty','other')),
  add column if not exists blocked_since timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists next_review_at timestamptz,
  add column if not exists priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent'));

create index if not exists work_orders_assigned_to_idx on public.work_orders(assigned_to);
create index if not exists work_orders_customer_promised_idx on public.work_orders(customer_promised_at);
create index if not exists work_orders_operational_state_idx on public.work_orders(operational_state);

create or replace view public.work_order_board
with (security_invoker=true)
as
select
  w.*,
  case
    when w.status in ('ready','delivered','cancelled') then 'done'
    when w.operational_state = 'waiting_parts' then 'waiting_parts'
    when w.operational_state = 'waiting_customer' then 'waiting_customer'
    when w.operational_state in ('third_party','technical_difficulty','other') then 'blocked'
    when w.customer_promised_at is not null and now() > w.customer_promised_at then 'overdue'
    when w.customer_promised_at is not null and w.customer_promised_at <= now() + interval '6 hours' then 'attention'
    else 'on_track'
  end as health,
  case
    when w.blocked_since is not null then extract(epoch from (now() - w.blocked_since))/3600
    else null
  end as blocked_hours
from public.work_orders w;

grant select on public.work_order_board to authenticated;
