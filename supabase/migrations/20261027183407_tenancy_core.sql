-- =============================================================================
-- Astrum · F0 · Núcleo de multi-tenancy (tenant → workspace)
--
-- Modelo de acesso (ver docs/ARQUITETURA.md §4):
--   * tenant     = quem paga. memberships dá o papel do usuário no tenant.
--   * workspace  = onde se trabalha. owner/admin do tenant acessam todos os
--                  workspaces; demais usuários só os listados em workspace_members.
--   * Toda tabela de negócio futura terá (tenant_id, workspace_id) com FK
--     composta para workspaces e políticas usando
--     private.can_access_workspace(tenant_id, workspace_id).
--
-- Funções auxiliares ficam no schema `private` (não exposto pela Data API) e são
-- SECURITY DEFINER apenas para evitar recursão de RLS; todas filtram por auth.uid().
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.tenant_role as enum ('owner', 'admin', 'member');
create type public.workspace_role as enum ('manager', 'agent', 'viewer');
create type public.membership_status as enum ('active', 'suspended');
create type public.tenant_status as enum ('active', 'suspended', 'canceled');

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- "Clínica São João" -> "clinica-sao-joao"
create function private.slugify(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(value, '')),
      'áàâãäåçéèêëíìîïñóòôõöúùûüýÿ',
      'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9]+', '-', 'g'));
$$;

create function private.random_suffix()
returns text
language sql
volatile
set search_path = ''
as $$
  select substr(md5(gen_random_uuid()::text), 1, 6);
$$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 120),
  slug        text not null unique,
  status      public.tenant_status not null default 'active',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.tenant_role not null default 'member',
  status      public.membership_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.workspaces (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 120),
  slug         text not null,
  timezone     text not null default 'America/Sao_Paulo',
  locale       text not null default 'pt-BR',
  settings     jsonb not null default '{}'::jsonb,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, slug),
  -- alvo das FKs compostas (tenant_id, workspace_id) das tabelas de negócio
  unique (tenant_id, id)
);

create table public.workspace_members (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  user_id       uuid not null,
  role          public.workspace_role not null default 'agent',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id),
  -- o workspace precisa ser do mesmo tenant...
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- ...e o usuário precisa ser membro desse tenant
  foreign key (tenant_id, user_id)
    references public.memberships (tenant_id, user_id) on delete cascade
);
create index workspace_members_user_idx on public.workspace_members (user_id);
create index workspace_members_tenant_user_idx on public.workspace_members (tenant_id, user_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger tenants_updated_at before update on public.tenants
  for each row execute function private.set_updated_at();
create trigger memberships_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger workspace_members_updated_at before update on public.workspace_members
  for each row execute function private.set_updated_at();

-- Slug do workspace gerado quando não informado
create function private.workspaces_default_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := coalesce(nullif(private.slugify(new.name), ''), 'workspace')
                || '-' || private.random_suffix();
  else
    new.slug := private.slugify(new.slug);
  end if;
  return new;
end;
$$;
create trigger workspaces_default_slug before insert on public.workspaces
  for each row execute function private.workspaces_default_slug();

-- Perfil criado automaticamente para cada usuário do Supabase Auth.
-- `name` vem de user_metadata apenas para exibição — nunca para autorização.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'name')
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Um tenant nunca pode ficar sem owner ativo.
create function private.memberships_keep_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active')
     and exists (select 1 from public.tenants t where t.id = old.tenant_id)
     and not exists (
       select 1 from public.memberships m
       where m.tenant_id = old.tenant_id
         and m.id <> old.id
         and m.role = 'owner'
         and m.status = 'active')
  then
    raise exception 'O tenant precisa de pelo menos um owner ativo'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger memberships_keep_owner before update or delete on public.memberships
  for each row execute function private.memberships_keep_owner();

-- -----------------------------------------------------------------------------
-- Funções de autorização (usadas nas políticas)
-- -----------------------------------------------------------------------------
create function private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active');
$$;

create function private.has_tenant_role(p_tenant_id uuid, p_roles public.tenant_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles));
$$;

-- Recebem tenant_id e workspace_id da própria linha (garantidos consistentes pelas
-- FKs compostas) em vez de consultar workspaces: assim funcionam também no
-- INSERT ... RETURNING, quando a linha nova ainda não está visível.
create function private.can_access_workspace(p_tenant_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.role in ('owner', 'admin')
           or exists (
             select 1 from public.workspace_members wm
             where wm.tenant_id = p_tenant_id
               and wm.workspace_id = p_workspace_id
               and wm.user_id = m.user_id)));
$$;

create function private.has_workspace_role(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (m.role in ('owner', 'admin')
           or exists (
             select 1 from public.workspace_members wm
             where wm.tenant_id = p_tenant_id
               and wm.workspace_id = p_workspace_id
               and wm.user_id = m.user_id
               and wm.role = any (p_roles))));
$$;

create function private.shares_tenant_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user_id);
$$;

-- -----------------------------------------------------------------------------
-- Operações privilegiadas (chamadas pela API, nunca expostas pela Data API)
-- -----------------------------------------------------------------------------

-- Onboarding: cria tenant + workspace inicial e torna o chamador owner.
create function private.create_tenant(p_name text, p_workspace_name text default 'Principal')
returns public.tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tenant public.tenants;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Perfil não encontrado' using errcode = '42501';
  end if;

  insert into public.tenants (name, slug)
  values (trim(p_name),
          coalesce(nullif(private.slugify(p_name), ''), 'conta') || '-' || private.random_suffix())
  returning * into v_tenant;

  insert into public.memberships (tenant_id, user_id, role)
  values (v_tenant.id, v_uid, 'owner');

  insert into public.workspaces (tenant_id, name)
  values (v_tenant.id, coalesce(nullif(trim(p_workspace_name), ''), 'Principal'));

  return v_tenant;
end;
$$;

-- Adiciona ao tenant um usuário que já tem conta (convite por e-mail vem depois).
create function private.add_tenant_member_by_email(
  p_tenant_id uuid,
  p_email text,
  p_role public.tenant_role default 'member')
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_membership public.memberships;
begin
  if not private.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.tenant_role[]) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if p_role = 'owner' and not private.has_tenant_role(p_tenant_id, array['owner']::public.tenant_role[]) then
    raise exception 'Só um owner pode adicionar outro owner' using errcode = '42501';
  end if;

  select p.id into v_user_id
  from public.profiles p
  where lower(p.email) = lower(trim(p_email));

  if v_user_id is null then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  values (p_tenant_id, v_user_id, p_role)
  returning * into v_membership;

  return v_membership;
end;
$$;

grant execute on function
  private.is_tenant_member(uuid),
  private.has_tenant_role(uuid, public.tenant_role[]),
  private.can_access_workspace(uuid, uuid),
  private.has_workspace_role(uuid, uuid, public.workspace_role[]),
  private.shares_tenant_with(uuid),
  private.create_tenant(text, text),
  private.add_tenant_member_by_email(uuid, text, public.tenant_role)
to authenticated;

-- -----------------------------------------------------------------------------
-- Privilégios de tabela (explícitos: tabelas novas não são expostas por padrão
-- e UPDATE só nas colunas editáveis, impedindo mover linhas entre tenants)
-- -----------------------------------------------------------------------------
revoke all on public.profiles, public.tenants, public.memberships,
              public.workspaces, public.workspace_members
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (name, avatar_url) on public.profiles to authenticated;

grant select on public.tenants to authenticated;
grant update (name, settings) on public.tenants to authenticated;

grant select, insert, delete on public.memberships to authenticated;
grant update (role, status) on public.memberships to authenticated;

grant select, insert, delete on public.workspaces to authenticated;
grant update (name, slug, timezone, locale, settings, archived_at) on public.workspaces to authenticated;

grant select, insert, delete on public.workspace_members to authenticated;
grant update (role) on public.workspace_members to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- profiles: o próprio usuário e quem divide algum tenant com ele
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_tenant_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- tenants: membros leem; owner/admin editam. Criação só via private.create_tenant.
create policy tenants_select on public.tenants for select to authenticated
  using (private.is_tenant_member(id));
create policy tenants_update on public.tenants for update to authenticated
  using (private.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]))
  with check (private.has_tenant_role(id, array['owner', 'admin']::public.tenant_role[]));

-- memberships: membros veem os colegas; owner/admin gerenciam;
-- só owner cria/promove owner; cada um pode sair do tenant.
create policy memberships_select on public.memberships for select to authenticated
  using (private.is_tenant_member(tenant_id));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (role <> 'owner' or private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])));
create policy memberships_update on public.memberships for update to authenticated
  using (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (
    private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
    and (role <> 'owner' or private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[])));
create policy memberships_delete on public.memberships for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[])
        and (role <> 'owner' or private.has_tenant_role(tenant_id, array['owner']::public.tenant_role[]))));

-- workspaces: quem tem acesso lê; owner/admin do tenant criam, editam e removem.
create policy workspaces_select on public.workspaces for select to authenticated
  using (private.can_access_workspace(tenant_id, id));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy workspaces_update on public.workspaces for update to authenticated
  using (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]))
  with check (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (private.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- workspace_members: quem acessa o workspace vê a equipe;
-- owner/admin do tenant e managers do workspace gerenciam.
create policy workspace_members_select on public.workspace_members for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
