-- v14.0 team management and configurable role matrix
create table if not exists public.permission_catalog (
  permission text primary key,
  category text not null,
  label text not null,
  description text not null,
  sort_order integer not null default 0,
  visible boolean not null default true
);

insert into public.permission_catalog(permission,category,label,description,sort_order,visible) values
('*','Sistema','Acesso total','Permissão reservada ao proprietário.',0,false),
('customers.read','Clientes','Ver clientes','Consultar clientes e veículos.',10,true),
('customers.write','Clientes','Editar clientes','Cadastrar e alterar clientes e veículos.',20,true),
('work_orders.read_all','Ordens de serviço','Ver todas as OS','Consultar todas as ordens da oficina.',30,true),
('work_orders.write_all','Ordens de serviço','Gerenciar todas as OS','Criar e alterar qualquer ordem de serviço.',40,true),
('work_orders.read_assigned','Ordens de serviço','Ver OS atribuídas','Consultar apenas ordens atribuídas ao usuário.',50,true),
('work_orders.write_assigned','Ordens de serviço','Atualizar OS atribuídas','Atualizar andamento das ordens atribuídas ao usuário.',60,true),
('inspections.read_all','Vistorias','Ver todas as vistorias','Consultar fotos e evidências de todas as OS.',70,true),
('inspections.write_all','Vistorias','Registrar vistorias','Adicionar evidências em todas as OS.',80,true),
('inspections.read_assigned','Vistorias','Ver vistorias atribuídas','Consultar evidências apenas das OS atribuídas.',90,true),
('inspections.write_assigned','Vistorias','Registrar vistoria atribuída','Adicionar evidências apenas nas OS atribuídas.',100,true),
('budgets.read','Orçamentos','Ver orçamentos','Consultar itens, valores e revisões.',110,true),
('budgets.write','Orçamentos','Editar orçamentos','Criar revisões e alterar itens e valores.',120,true),
('budgets.send','Orçamentos','Enviar para aprovação','Gerar e revogar links públicos de aprovação.',130,true),
('catalog.read','Catálogo / estoque','Ver catálogo','Consultar peças, serviços e valores de venda.',140,true),
('catalog.write','Catálogo / estoque','Editar catálogo','Cadastrar e alterar peças, serviços e estoque.',150,true),
('finance.read','Financeiro','Ver financeiro','Consultar custos, compras, recebíveis e pagamentos.',160,true),
('finance.write','Financeiro','Gerenciar financeiro','Registrar despesas, compras e baixas financeiras.',170,true),
('activity.read_all','Histórico','Ver todo histórico','Consultar eventos de todas as OS.',180,true),
('activity.read_assigned','Histórico','Ver histórico atribuído','Consultar eventos das OS atribuídas.',190,true),
('team.read','Equipe','Ver equipe','Consultar usuários, perfis e acessos.',200,true),
('team.manage','Equipe','Gerenciar equipe','Convidar, ativar, desativar e alterar perfis.',210,true)
on conflict (permission) do update set
category=excluded.category,label=excluded.label,description=excluded.description,sort_order=excluded.sort_order,visible=excluded.visible;

alter table public.permission_catalog enable row level security;
drop policy if exists permission_catalog_read on public.permission_catalog;
drop policy if exists permission_catalog_write on public.permission_catalog;
create policy permission_catalog_read on public.permission_catalog for select to authenticated using (private.has_permission('team.read'));
create policy permission_catalog_write on public.permission_catalog for all to authenticated using (private.has_permission('team.manage')) with check (private.has_permission('team.manage'));

create or replace function public.staff_directory()
returns table(user_id uuid,email text,full_name text,role text,active boolean,status text,created_at timestamptz,expires_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not private.has_permission('team.read') then raise exception 'not_allowed' using errcode='42501'; end if;
  return query
  select sp.id,u.email::text,sp.full_name,sp.role,sp.active,
    case when sp.active then 'active' else 'inactive' end::text,sp.created_at,null::timestamptz
  from public.staff_profiles sp join auth.users u on u.id=sp.id
  union all
  select null::uuid,i.email,i.full_name,i.role,false,'invited'::text,i.created_at,i.expires_at
  from private.staff_invites i
  where i.accepted_at is null and (i.expires_at is null or i.expires_at>now())
  order by created_at desc;
end
$$;

create or replace function public.create_staff_invite(p_email text,p_full_name text,p_role text,p_expires_days integer default 30)
returns uuid language plpgsql security definer set search_path=''
as $$
declare invite_id uuid;
begin
  if not private.has_permission('team.manage') then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_role not in ('owner','manager','reception','mechanic','finance') then raise exception 'invalid_role'; end if;
  if nullif(trim(p_email),'') is null or position('@' in p_email)=0 then raise exception 'invalid_email'; end if;
  if nullif(trim(p_full_name),'') is null then raise exception 'invalid_name'; end if;

  insert into private.staff_invites(email,full_name,role,invited_by,created_at,expires_at,accepted_at,accepted_user_id)
  values(lower(trim(p_email)),trim(p_full_name),p_role,(select auth.uid()),now(),
    now()+make_interval(days=>greatest(1,least(coalesce(p_expires_days,30),90))),null,null)
  on conflict ((lower(email))) do update
  set full_name=excluded.full_name,role=excluded.role,invited_by=excluded.invited_by,
      created_at=excluded.created_at,expires_at=excluded.expires_at,accepted_at=null,accepted_user_id=null
  returning id into invite_id;

  return invite_id;
end
$$;

create or replace function public.manage_staff_member(p_user_id uuid,p_role text,p_active boolean)
returns public.staff_profiles language plpgsql security definer set search_path=''
as $$
declare current_row public.staff_profiles; result_row public.staff_profiles; remaining_owners integer;
begin
  if not private.has_permission('team.manage') then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_role not in ('owner','manager','reception','mechanic','finance') then raise exception 'invalid_role'; end if;

  select * into current_row from public.staff_profiles where id=p_user_id for update;
  if not found then raise exception 'staff_not_found'; end if;

  if current_row.role='owner' and current_row.active=true and (p_role<>'owner' or p_active=false) then
    select count(*) into remaining_owners from public.staff_profiles where id<>p_user_id and role='owner' and active=true;
    if remaining_owners=0 then raise exception 'last_owner_protected'; end if;
  end if;

  update public.staff_profiles set role=p_role,active=p_active,updated_at=now()
  where id=p_user_id returning * into result_row;
  return result_row;
end
$$;

revoke all on function public.staff_directory() from public,anon;
revoke all on function public.create_staff_invite(text,text,text,integer) from public,anon;
revoke all on function public.manage_staff_member(uuid,text,boolean) from public,anon;
grant execute on function public.staff_directory() to authenticated;
grant execute on function public.create_staff_invite(text,text,text,integer) to authenticated;
grant execute on function public.manage_staff_member(uuid,text,boolean) to authenticated;
