-- =============================================================================
-- Astrum · F1.1 · Contatos, identidades de canal e empresas
-- Baseado em packages/db/templates/workspace-table.sql (skill astrum-nova-tabela).
-- Papéis: viewer lê · agent cria/edita/arquiva · manager também apaga.
-- Exceção: identidades de canal podem ser removidas pelo agent (é edição do contato).
-- =============================================================================

create type public.contact_type as enum ('lead', 'customer', 'other');
create type public.lgpd_status as enum ('unknown', 'consented', 'opted_out');
create type public.identity_channel as enum (
  'phone', 'whatsapp', 'email', 'instagram', 'messenger', 'telegram', 'other');

-- -----------------------------------------------------------------------------
-- companies
-- -----------------------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  name          text not null check (length(trim(name)) between 1 and 200),
  document      text check (document ~ '^[0-9]{14}$'),               -- CNPJ só dígitos
  domain        text check (domain = lower(domain) and length(domain) <= 253),
  phone         text check (phone ~ '^\+[1-9][0-9]{7,14}$'),          -- E.164
  owner_id      uuid,
  custom        jsonb not null default '{}'::jsonb,
  archived_at   timestamptz,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- responsável precisa ser membro do tenant
  foreign key (tenant_id, owner_id)
    references public.memberships (tenant_id, user_id) on delete set null (owner_id)
);

create index companies_workspace_created_idx on public.companies (workspace_id, created_at desc);
create index companies_workspace_name_idx on public.companies (workspace_id, lower(name));
create unique index companies_workspace_document_key on public.companies (workspace_id, document)
  where document is not null;

create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  name          text not null check (length(trim(name)) between 1 and 200),
  type          public.contact_type not null default 'lead',
  company_id    uuid,
  owner_id      uuid,
  avatar_url    text,
  custom        jsonb not null default '{}'::jsonb,
  lgpd_status   public.lgpd_status not null default 'unknown',
  archived_at   timestamptz,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- empresa precisa ser do mesmo workspace
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete set null (company_id),
  foreign key (tenant_id, owner_id)
    references public.memberships (tenant_id, user_id) on delete set null (owner_id)
);

create index contacts_workspace_created_idx on public.contacts (workspace_id, created_at desc);
create index contacts_workspace_name_idx on public.contacts (workspace_id, lower(name));
create index contacts_workspace_company_idx on public.contacts (workspace_id, company_id)
  where company_id is not null;

create trigger contacts_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- contact_identities — como o contato é encontrado em cada canal.
-- Únicas por workspace: base da deduplicação e de ligar conversas (F2) ao contato.
-- -----------------------------------------------------------------------------
create table public.contact_identities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  contact_id    uuid not null,
  channel       public.identity_channel not null,
  identifier    text not null,
  is_primary    boolean not null default false,
  -- marcado só pelo sistema (ex.: mensagem recebida do número); não está nos grants
  verified      boolean not null default false,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, channel, identifier),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  -- formato já normalizado pela API; o banco garante
  constraint contact_identities_identifier_format check (
    case channel
      when 'phone'    then identifier ~ '^\+[1-9][0-9]{7,14}$'
      when 'whatsapp' then identifier ~ '^\+[1-9][0-9]{7,14}$'
      when 'email'    then identifier = lower(identifier)
                           and identifier ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                           and length(identifier) <= 320
      when 'instagram' then identifier ~ '^[a-z0-9._]{1,30}$'
      when 'telegram'  then identifier ~ '^[a-z0-9_]{5,32}$'
      else length(identifier) between 1 and 320
    end)
);

create index contact_identities_workspace_identifier_idx
  on public.contact_identities (workspace_id, identifier);
create index contact_identities_contact_idx on public.contact_identities (workspace_id, contact_id);
-- no máximo uma identidade principal por canal em cada contato
create unique index contact_identities_one_primary_key
  on public.contact_identities (contact_id, channel) where is_primary;

create trigger contact_identities_updated_at before update on public.contact_identities
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privilégios: INSERT/UPDATE só nas colunas que o usuário informa
-- -----------------------------------------------------------------------------
revoke all on public.companies, public.contacts, public.contact_identities from anon, authenticated;

grant select, delete on public.companies to authenticated;
grant insert (tenant_id, workspace_id, name, document, domain, phone, owner_id, custom)
  on public.companies to authenticated;
grant update (name, document, domain, phone, owner_id, custom, archived_at)
  on public.companies to authenticated;

grant select, delete on public.contacts to authenticated;
grant insert (tenant_id, workspace_id, name, type, company_id, owner_id, avatar_url, custom, lgpd_status)
  on public.contacts to authenticated;
grant update (name, type, company_id, owner_id, avatar_url, custom, lgpd_status, archived_at)
  on public.contacts to authenticated;

grant select, delete on public.contact_identities to authenticated;
grant insert (tenant_id, workspace_id, contact_id, channel, identifier, is_primary)
  on public.contact_identities to authenticated;
-- identificador é imutável: para trocar, remova e crie outra identidade
grant update (is_primary) on public.contact_identities to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;

-- companies
create policy companies_select on public.companies for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy companies_insert on public.companies for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy companies_update on public.companies for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy companies_delete on public.companies for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager']::public.workspace_role[]));

-- contacts
create policy contacts_select on public.contacts for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy contacts_update on public.contacts for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy contacts_delete on public.contacts for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager']::public.workspace_role[]));

-- contact_identities (agent também remove)
create policy contact_identities_select on public.contact_identities for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy contact_identities_insert on public.contact_identities for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy contact_identities_update on public.contact_identities for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
create policy contact_identities_delete on public.contact_identities for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));
