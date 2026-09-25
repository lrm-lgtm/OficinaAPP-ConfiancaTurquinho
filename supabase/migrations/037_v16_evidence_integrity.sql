-- v16 evidence integrity
-- New inspection evidence stores a SHA-256 fingerprint and becomes immutable to authenticated clients.

alter table public.inspection_photos
  add column if not exists sha256 text,
  add column if not exists byte_size bigint,
  add column if not exists mime_type text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists sealed_at timestamptz;

alter table public.inspection_photos
  drop constraint if exists inspection_photos_sha256_check,
  add constraint inspection_photos_sha256_check
    check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  drop constraint if exists inspection_photos_byte_size_check,
  add constraint inspection_photos_byte_size_check
    check (byte_size is null or byte_size > 0),
  drop constraint if exists inspection_photos_mime_type_check,
  add constraint inspection_photos_mime_type_check
    check (mime_type is null or mime_type like 'image/%');

create index if not exists inspection_photos_created_by_idx
  on public.inspection_photos(created_by);

create or replace function private.seal_inspection_photo_metadata()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.created_by is null then
    new.created_by:=(select auth.uid());
  end if;

  if new.sha256 is not null
     and new.byte_size is not null
     and new.mime_type is not null
     and new.sealed_at is null then
    new.sealed_at:=now();
  end if;

  return new;
end
$$;

drop trigger if exists inspection_photo_seal_metadata
  on public.inspection_photos;

create trigger inspection_photo_seal_metadata
before insert on public.inspection_photos
for each row
execute function private.seal_inspection_photo_metadata();

-- Inspection rows are append-only evidence for authenticated workshop clients.
drop policy if exists inspection_update on public.inspection_photos;

-- Storage objects in the evidence bucket are also append-only.
drop policy if exists "rbac evidence update" on storage.objects;

revoke all on function private.seal_inspection_photo_metadata() from public,anon,authenticated;
grant execute on function private.seal_inspection_photo_metadata() to service_role;
