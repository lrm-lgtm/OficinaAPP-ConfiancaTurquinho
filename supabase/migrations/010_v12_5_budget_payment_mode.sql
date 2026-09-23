-- v12.5 Payment condition per budget revision
alter table public.budget_revisions
  add column if not exists payment_mode text not null default 'pay_now'
    check (payment_mode in ('pay_now','credit')),
  add column if not exists payment_due_at timestamptz,
  add column if not exists payment_note text;

create index if not exists budget_revisions_payment_mode_idx
  on public.budget_revisions(payment_mode);

comment on column public.budget_revisions.payment_mode is
  'pay_now = client approves and is directed to payment; credit = approval only, payment later';
