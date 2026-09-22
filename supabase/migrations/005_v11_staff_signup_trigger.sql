-- v11.3.1: create an inactive staff profile automatically after Auth signup.
-- New users still have zero access to internal tables until an owner/manager activates them.

create or replace function public.handle_new_staff_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_profiles(id, full_name, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(coalesce(new.email,''),'@',1), 'Usuário'),
    'mechanic',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff on auth.users;
create trigger on_auth_user_created_staff
after insert on auth.users
for each row execute function public.handle_new_staff_user();
