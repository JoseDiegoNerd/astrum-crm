-- =============================================================================
-- Astrum · F1.4 · Tarefas e notas
-- Baseado em packages/db/templates/workspace-table.sql (skill astrum-nova-tabela).
--
-- tasks: agent cria/edita/conclui; manager exclui. Podem existir sem vínculo
--        (apagar o contato/negócio/empresa só desfaz o vínculo).
-- notes: sempre ligadas a contato, negócio ou empresa (somem junto com eles);
--        qualquer agent cria, só o autor edita, manager exclui.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  title         text not null check (length(trim(title)) between 1 and 200),
  description   text check (length(description) <= 5000),
  due_at        timestamptz,
  assignee_id   uuid,
  contact_id    uuid,
  deal_id       uuid,
  company_id    uuid,
  done_at       timestamptz,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (tenant_id, assignee_id)
    references public.memberships (tenant_id, user_id) on delete set null (assignee_id),
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete set null (contact_id),
  foreign key (workspace_id, deal_id)
    references public.deals (workspace_id, id) on delete set null (deal_id),
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete set null (company_id)
);

-- "minhas tarefas": abertas do responsável, por prazo
create index tasks_assignee_open_idx on public.tasks (workspace_id, assignee_id, due_at)
  where done_at is null;
create index tasks_contact_idx on public.tasks (workspace_id, contact_id) where contact_id is not null;
create index tasks_deal_idx on public.tasks (workspace_id, deal_id) where deal_id is not null;
create index tasks_company_idx on public.tasks (workspace_id, company_id) where company_id is not null;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- notes
-- -----------------------------------------------------------------------------
create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  body          text not null check (length(trim(body)) between 1 and 10000),
  contact_id    uuid,
  deal_id       uuid,
  company_id    uuid,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- cascade: uma nota sem assunto não faz sentido (e violaria o check abaixo)
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, deal_id)
    references public.deals (workspace_id, id) on delete cascade,
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete cascade,
  constraint notes_subject_check check (num_nonnulls(contact_id, deal_id, company_id) >= 1)
);

create index notes_contact_idx on public.notes (workspace_id, contact_id, created_at desc) where contact_id is not null;
create index notes_deal_idx on public.notes (workspace_id, deal_id, created_at desc) where deal_id is not null;
create index notes_company_idx on public.notes (workspace_id, company_id, created_at desc) where company_id is not null;

create trigger notes_updated_at before update on public.notes
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
revoke all on public.tasks, public.notes from anon, authenticated;

grant select, delete on public.tasks to authenticated;
grant insert (tenant_id, workspace_id, title, description, due_at, assignee_id, contact_id, deal_id, company_id)
  on public.tasks to authenticated;
grant update (title, description, due_at, assignee_id, contact_id, deal_id, company_id, done_at)
  on public.tasks to authenticated;

grant select, delete on public.notes to authenticated;
grant insert (tenant_id, workspace_id, body, contact_id, deal_id, company_id) on public.notes to authenticated;
-- o assunto da nota não muda depois de criada
grant update (body) on public.notes to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.notes enable row level security;

create policy tasks_select on public.tasks for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy tasks_update on public.tasks for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy notes_select on public.notes for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy notes_insert on public.notes for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
-- só o autor edita (e precisa continuar podendo escrever no workspace)
create policy notes_update on public.notes for update to authenticated
  using (
    created_by = (select auth.uid())
    and private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]))
  with check (
    created_by = (select auth.uid())
    and private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
create policy notes_delete on public.notes for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
