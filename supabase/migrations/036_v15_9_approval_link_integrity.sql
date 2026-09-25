-- v15.9 approval-link integrity
-- New budget revisions revoke previous links and expired/near-expiry links are rotated server-side.

create or replace function private.revoke_previous_budget_approval_tokens()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.approval_tokens at
  set revoked_at=coalesce(at.revoked_at,now())
  where at.budget_revision_id in (
    select br.id
    from public.budget_revisions br
    where br.work_order_id=new.work_order_id
      and br.id<>new.id
  )
    and at.revoked_at is null;

  return new;
end
$$;

drop trigger if exists budget_revision_revoke_previous_links
  on public.budget_revisions;

create trigger budget_revision_revoke_previous_links
after insert on public.budget_revisions
for each row
execute function private.revoke_previous_budget_approval_tokens();

create or replace function public.ensure_approval_token(
  p_budget_revision_id uuid
)
returns table(
  token uuid,
  expires_at timestamptz,
  rotated boolean
)
language plpgsql
security definer
set search_path=''
as $$
declare
  br public.budget_revisions;
  token_row public.approval_tokens;
  new_token uuid;
  new_expires timestamptz;
  should_rotate boolean:=false;
begin
  if not private.has_permission('budgets.send') then
    raise exception 'not_allowed' using errcode='42501';
  end if;

  select * into br
  from public.budget_revisions
  where id=p_budget_revision_id
  for update;

  if not found then raise exception 'budget_not_found'; end if;
  if br.status not in ('draft','sent','revision_requested') then
    raise exception 'budget_not_sendable';
  end if;

  if exists(
    select 1 from public.approvals a
    where a.budget_revision_id=br.id
  ) then
    raise exception 'budget_already_decided';
  end if;

  -- A newer revision always invalidates links from older revisions of the same OS.
  update public.approval_tokens at
  set revoked_at=coalesce(at.revoked_at,now())
  where at.budget_revision_id in (
    select older.id
    from public.budget_revisions older
    where older.work_order_id=br.work_order_id
      and older.id<>br.id
  )
    and at.revoked_at is null;

  select * into token_row
  from public.approval_tokens
  where budget_revision_id=br.id
  for update;

  if found then
    should_rotate:=
      token_row.revoked_at is not null
      or token_row.expires_at is null
      or token_row.expires_at<=now()+interval '24 hours';

    if should_rotate then
      new_token:=gen_random_uuid();
      new_expires:=now()+interval '30 days';

      update public.approval_tokens
      set token=new_token,
          expires_at=new_expires,
          revoked_at=null
      where id=token_row.id;

      insert into public.activity_log(
        work_order_id,actor_user_id,actor_type,event_type,payload
      )
      values(
        br.work_order_id,(select auth.uid()),'user','approval_link_renewed',
        jsonb_build_object(
          'budget_revision_id',br.id,
          'revision',br.revision,
          'expires_at',new_expires
        )
      );

      return query select new_token,new_expires,true;
      return;
    end if;

    return query select token_row.token,token_row.expires_at,false;
    return;
  end if;

  new_token:=gen_random_uuid();
  new_expires:=now()+interval '30 days';

  insert into public.approval_tokens(
    budget_revision_id,token,expires_at,revoked_at
  )
  values(
    br.id,new_token,new_expires,null
  );

  insert into public.activity_log(
    work_order_id,actor_user_id,actor_type,event_type,payload
  )
  values(
    br.work_order_id,(select auth.uid()),'user','approval_link_created',
    jsonb_build_object(
      'budget_revision_id',br.id,
      'revision',br.revision,
      'expires_at',new_expires
    )
  );

  return query select new_token,new_expires,true;
end
$$;

revoke all on function private.revoke_previous_budget_approval_tokens() from public,anon,authenticated;
revoke all on function public.ensure_approval_token(uuid) from public,anon;
grant execute on function public.ensure_approval_token(uuid) to authenticated;
