-- v15.6 indexes for cancellation-adjustment foreign keys

create index if not exists cancellation_stock_resolutions_created_by_idx
  on public.cancellation_stock_resolutions(created_by);

create index if not exists cancellation_payment_resolutions_created_by_idx
  on public.cancellation_payment_resolutions(created_by);

create index if not exists customer_credits_created_by_idx
  on public.customer_credits(created_by);

create index if not exists customer_credits_source_payment_idx
  on public.customer_credits(source_payment_id);

create index if not exists payment_refunds_created_by_idx
  on public.payment_refunds(created_by);

create index if not exists payment_refunds_work_order_idx
  on public.payment_refunds(work_order_id);

create index if not exists provider_payment_adjustment_requests_created_by_idx
  on public.provider_payment_adjustment_requests(created_by);

create index if not exists provider_payment_adjustment_requests_work_order_idx
  on public.provider_payment_adjustment_requests(work_order_id);
