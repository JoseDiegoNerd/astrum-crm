-- =============================================================================
-- Astrum · F1.2 · Tags e campos customizados
-- Baseado em packages/db/templates/workspace-table.sql (skill astrum-nova-tabela).
--
-- Configuração (tags, definições de campos): só manager cria/edita/apaga.
-- Aplicação de tags a contatos/empresas: agent e manager (sem edição: aplica ou remove).
-- Valores dos campos ficam em contacts.custom / companies.custom (jsonb),
-- validados pela API contra custom_field_defs.
-- =============================================================================

create type public.custom_field_entity as enum ('contact', 'company', 'deal');
create type public.custom_field_type as enum ('text', 'number', 'date', 'boolean', 'select', 'multiselect');

-- -----------------------------------------------------------------------------
-- tags
-- -----------------------------------------------------------------------------
create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  name          text not null check (length(trim(name)) between 1 and 50),
  color         text not null default '#6366f1' check (color ~ '^#[0-9a-f]{6}$'),
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade
);

create unique index tags_workspace_name_key on public.tags (workspace_id, lower(name));

create trigger tags_updated_at before update on public.tags
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- contact_tags / company_tags — junções com FK real (sem polimorfismo)
-- -----------------------------------------------------------------------------
create table public.contact_tags (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  contact_id    uuid not null,
  tag_id        uuid not null,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (contact_id, tag_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id)
    references public.tags (workspace_id, id) on delete cascade
);
create index contact_tags_workspace_tag_idx on public.contact_tags (workspace_id, tag_id);

create table public.company_tags (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  company_id    uuid not null,
  tag_id        uuid not null,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, tag_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id)
    references public.tags (workspace_id, id) on delete cascade
);
create index company_tags_workspace_tag_idx on public.company_tags (workspace_id, tag_id);

-- -----------------------------------------------------------------------------
-- custom_field_defs
-- entity, key e type são imutáveis: mudar o tipo invalidaria os valores salvos.
-- -----------------------------------------------------------------------------
create table public.custom_field_defs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  entity        public.custom_field_entity not null,
  key           text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label         text not null check (length(trim(label)) between 1 and 80),
  type          public.custom_field_type not null,
  options       jsonb not null default '[]'::jsonb,
  required      boolean not null default false,
  position      integer not null default 0,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, entity, key),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- select/multiselect exigem lista de opções (texto); demais tipos, lista vazia
  constraint custom_field_defs_options_check check (
    jsonb_typeof(options) = 'array'
    and case
      when type in ('select', 'multiselect') then jsonb_array_length(options) between 1 and 100
      else jsonb_array_length(options) = 0
    end)
);
create index custom_field_defs_workspace_entity_idx
  on public.custom_field_defs (workspace_id, entity, position);

create trigger custom_field_defs_updated_at before update on public.custom_field_defs
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
revoke all on public.tags, public.contact_tags, public.company_tags, public.custom_field_defs
  from anon, authenticated;

grant select, delete on public.tags to authenticated;
grant insert (tenant_id, workspace_id, name, color) on public.tags to authenticated;
grant update (name, color) on public.tags to authenticated;

grant select, delete on public.contact_tags, public.company_tags to authenticated;
grant insert (tenant_id, workspace_id, contact_id, tag_id) on public.contact_tags to authenticated;
grant insert (tenant_id, workspace_id, company_id, tag_id) on public.company_tags to authenticated;

grant select, delete on public.custom_field_defs to authenticated;
grant insert (tenant_id, workspace_id, entity, key, label, type, options, required, position)
  on public.custom_field_defs to authenticated;
grant update (label, options, required, position) on public.custom_field_defs to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.tags enable row level security;
alter table public.contact_tags enable row level security;
alter table public.company_tags enable row level security;
alter table public.custom_field_defs enable row level security;

-- tags e custom_field_defs: configuração do workspace → só manager escreve
create policy tags_select on public.tags for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy tags_insert on public.tags for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy tags_update on public.tags for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy tags_delete on public.tags for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy custom_field_defs_select on public.custom_field_defs for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy custom_field_defs_insert on public.custom_field_defs for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy custom_field_defs_update on public.custom_field_defs for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy custom_field_defs_delete on public.custom_field_defs for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

-- junções: aplicar/remover tag é trabalho do dia a dia → agent e manager
create policy contact_tags_select on public.contact_tags for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy contact_tags_insert on public.contact_tags for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy contact_tags_delete on public.contact_tags for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));

create policy company_tags_select on public.company_tags for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy company_tags_insert on public.company_tags for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy company_tags_delete on public.company_tags for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
