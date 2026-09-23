-- v13.4 pre-authorized staff invitations
create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  role text not null default 'mechanic'
    check (role in ('owner','manager','reception','mechanic','finance')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users(id)
);

create unique index if not exists staff_invites_email_uq
  on private.staff_invites ((lower(email)));

create or replace function public.handle_new_staff_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite_id uuid;
  v_invite_name text;
  v_invite_role text;
begin
  select i.id, i.full_name, i.role
    into v_invite_id, v_invite_name, v_invite_role
  from private.staff_invites i
  where lower(i.email)=lower(coalesce(new.email,''))
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now())
  order by i.created_at desc
  limit 1;

  insert into public.staff_profiles(id, full_name, role, active)
  values (
    new.id,
    coalesce(v_invite_name, nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1), 'Usuário'),
    coalesce(v_invite_role, 'mechanic'),
    v_invite_id is not null
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    role = case when v_invite_id is not null then excluded.role else public.staff_profiles.role end,
    active = case when v_invite_id is not null then true else public.staff_profiles.active end,
    updated_at = now();

  if v_invite_id is not null then
    update private.staff_invites
    set accepted_at=now(), accepted_user_id=new.id
    where id=v_invite_id;
  end if;

  return new;
end;
$$;
