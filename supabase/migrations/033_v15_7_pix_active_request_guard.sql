-- v15.7 prevent concurrent duplicate active Pix requests

create unique index if not exists payment_requests_one_active_pix_per_receivable
on public.payment_requests(receivable_id,provider,method)
where receivable_id is not null
  and provider='mercadopago'
  and method='pix'
  and status in ('draft','pending','processing');
