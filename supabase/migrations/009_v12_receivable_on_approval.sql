-- v12.3 one receivable per budget revision
create unique index if not exists receivables_budget_revision_unique
on public.receivables(budget_revision_id)
where budget_revision_id is not null;
