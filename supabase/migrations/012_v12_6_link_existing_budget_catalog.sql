-- v12.6.1 link historical budget lines to reusable catalog entries
update public.budget_items bi
set catalog_item_id=ci.id
from public.catalog_items ci
where bi.catalog_item_id is null
  and bi.kind=ci.kind
  and lower(trim(bi.description))=lower(trim(ci.name));
