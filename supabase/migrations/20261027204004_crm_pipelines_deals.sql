-- =============================================================================
-- Astrum · F1.3 · Funil: pipelines, etapas e negócios (+ tags de negócio)
-- Baseado em packages/db/templates/workspace-table.sql (skill astrum-nova-tabela).
--
-- Pipelines e etapas são configuração → só manager escreve.
-- Negócios são trabalho do dia a dia → agent cria/edita/move; manager apaga.
-- status/closed_at do negócio são derivados da etapa (trigger), nunca informados.
-- =============================================================================

create type public.stage_kind as enum ('open', 'won', 'lost');
create type public.deal_status as enum ('open', 'won', 'lost');

-- -----------------------------------------------------------------------------
-- pipelines
-- -----------------------------------------------------------------------------
create table public.pipelines (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  name          text not null check (length(trim(name)) between 1 and 80),
  is_default    boolean not null default false,
  position      integer not null default 0,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade
);
create index pipelines_workspace_idx on public.pipelines (workspace_id, position);
-- no máximo um pipeline padrão por workspace
create unique index pipelines_one_default_key on public.pipelines (workspace_id) where is_default;

create trigger pipelines_updated_at before update on public.pipelines
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- pipeline_stages
-- -----------------------------------------------------------------------------
create table public.pipeline_stages (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  pipeline_id   uuid not null,
  name          text not null check (length(trim(name)) between 1 and 80),
  position      integer not null default 0,
  probability   integer not null default 0 check (probability between 0 and 100),
  kind          public.stage_kind not null default 'open',
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  -- alvo da FK (pipeline_id, stage_id) dos negócios
  unique (pipeline_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, pipeline_id)
    references public.pipelines (workspace_id, id) on delete cascade
);
create index pipeline_stages_pipeline_idx on public.pipeline_stages (workspace_id, pipeline_id, position);

create trigger pipeline_stages_updated_at before update on public.pipeline_stages
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- deals
-- -----------------------------------------------------------------------------
create table public.deals (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  workspace_id       uuid not null,
  title              text not null check (length(trim(title)) between 1 and 200),
  pipeline_id        uuid not null,
  stage_id           uuid not null,
  contact_id         uuid,
  company_id         uuid,
  owner_id           uuid,
  value_cents        bigint not null default 0 check (value_cents between 0 and 100000000000000),
  currency           char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  expected_close_at  date,
  -- derivados da etapa (private.deals_sync_status); fora dos grants
  status             public.deal_status not null default 'open',
  closed_at          timestamptz,
  lost_reason        text check (length(lost_reason) <= 500),
  -- ordem dentro da coluna do kanban (menor = mais acima)
  position           double precision not null default 0,
  custom             jsonb not null default '{}'::jsonb,
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, pipeline_id)
    references public.pipelines (workspace_id, id) on delete restrict,
  -- etapa precisa ser do pipeline do negócio; etapa com negócios não pode ser apagada
  foreign key (pipeline_id, stage_id)
    references public.pipeline_stages (pipeline_id, id) on delete restrict,
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete set null (contact_id),
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete set null (company_id),
  foreign key (tenant_id, owner_id)
    references public.memberships (tenant_id, user_id) on delete set null (owner_id)
);
create index deals_board_idx on public.deals (workspace_id, pipeline_id, stage_id, position);
create index deals_workspace_created_idx on public.deals (workspace_id, created_at desc);
create index deals_contact_idx on public.deals (workspace_id, contact_id) where contact_id is not null;
create index deals_company_idx on public.deals (workspace_id, company_id) where company_id is not null;

create trigger deals_updated_at before update on public.deals
  for each row execute function private.set_updated_at();

-- status e closed_at acompanham o tipo da etapa
create function private.deals_sync_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind public.stage_kind;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select s.kind into v_kind from public.pipeline_stages s where s.id = new.stage_id;
  new.status := coalesce(v_kind, 'open')::text::public.deal_status;
  if new.status = 'open' then
    new.closed_at := null;
    new.lost_reason := null;
  elsif tg_op = 'INSERT' or old.status is distinct from new.status then
    new.closed_at := now();
  end if;
  if new.status <> 'lost' then
    new.lost_reason := null;
  end if;
  return new;
end;
$$;
create trigger deals_sync_status before insert or update of stage_id on public.deals
  for each row execute function private.deals_sync_status();

-- -----------------------------------------------------------------------------
-- deal_tags
-- -----------------------------------------------------------------------------
create table public.deal_tags (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  deal_id       uuid not null,
  tag_id        uuid not null,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (deal_id, tag_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, deal_id)
    references public.deals (workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id)
    references public.tags (workspace_id, id) on delete cascade
);
create index deal_tags_workspace_tag_idx on public.deal_tags (workspace_id, tag_id);

-- -----------------------------------------------------------------------------
-- Pipeline padrão "Vendas" em todo workspace (novo e existente)
-- -----------------------------------------------------------------------------
create function private.create_default_pipeline(p_tenant_id uuid, p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline uuid;
begin
  insert into public.pipelines (tenant_id, workspace_id, name, is_default)
  values (p_tenant_id, p_workspace_id, 'Vendas', true)
  returning id into v_pipeline;

  insert into public.pipeline_stages (tenant_id, workspace_id, pipeline_id, name, position, probability, kind)
  values
    (p_tenant_id, p_workspace_id, v_pipeline, 'Novo',        0, 10,  'open'),
    (p_tenant_id, p_workspace_id, v_pipeline, 'Qualificado', 1, 25,  'open'),
    (p_tenant_id, p_workspace_id, v_pipeline, 'Proposta',    2, 50,  'open'),
    (p_tenant_id, p_workspace_id, v_pipeline, 'Negociação',  3, 75,  'open'),
    (p_tenant_id, p_workspace_id, v_pipeline, 'Ganho',       4, 100, 'won'),
    (p_tenant_id, p_workspace_id, v_pipeline, 'Perdido',     5, 0,   'lost');
end;
$$;

-- Só a trigger chama: não fica disponível para usuários.
revoke execute on function private.create_default_pipeline(uuid, uuid) from public, authenticated;

create function private.workspaces_default_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.create_default_pipeline(new.tenant_id, new.id);
  return new;
end;
$$;
create trigger workspaces_default_pipeline after insert on public.workspaces
  for each row execute function private.workspaces_default_pipeline();

select private.create_default_pipeline(w.tenant_id, w.id)
from public.workspaces w
where not exists (select 1 from public.pipelines p where p.workspace_id = w.id);

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
revoke all on public.pipelines, public.pipeline_stages, public.deals, public.deal_tags
  from anon, authenticated;

grant select, delete on public.pipelines to authenticated;
grant insert (tenant_id, workspace_id, name, is_default, position) on public.pipelines to authenticated;
grant update (name, is_default, position) on public.pipelines to authenticated;

grant select, delete on public.pipeline_stages to authenticated;
grant insert (tenant_id, workspace_id, pipeline_id, name, position, probability, kind)
  on public.pipeline_stages to authenticated;
grant update (name, position, probability, kind) on public.pipeline_stages to authenticated;

grant select, delete on public.deals to authenticated;
grant insert (tenant_id, workspace_id, title, pipeline_id, stage_id, contact_id, company_id, owner_id,
              value_cents, currency, expected_close_at, lost_reason, position, custom)
  on public.deals to authenticated;
grant update (title, pipeline_id, stage_id, contact_id, company_id, owner_id,
              value_cents, currency, expected_close_at, lost_reason, position, custom)
  on public.deals to authenticated;

grant select, delete on public.deal_tags to authenticated;
grant insert (tenant_id, workspace_id, deal_id, tag_id) on public.deal_tags to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.deals enable row level security;
alter table public.deal_tags enable row level security;

-- pipelines e etapas: configuração → manager
create policy pipelines_select on public.pipelines for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy pipelines_insert on public.pipelines for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy pipelines_update on public.pipelines for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy pipelines_delete on public.pipelines for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

-- negócios: agent cria/edita/move; manager apaga
create policy deals_select on public.deals for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy deals_insert on public.deals for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy deals_update on public.deals for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy deals_delete on public.deals for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy deal_tags_select on public.deal_tags for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy deal_tags_insert on public.deal_tags for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy deal_tags_delete on public.deal_tags for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
