-- =============================================================================
-- Template: tabela de negócio de workspace (padrão Astrum)
--
-- Uso: copie para a migration criada com `supabase migration new <nome>`,
-- troque __table__ pelo nome (snake_case, plural) e ajuste as colunas de negócio
-- (marcadas com ▸). Este arquivo é validado por test/template.test.ts —
-- mantenha-o executável como está.
--
-- Papéis (workspace_role): viewer só lê · agent cria e edita · manager também apaga.
-- owner/admin do tenant contam como manager em todos os workspaces.
-- =============================================================================

create table public.__table__ (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  -- ▸ colunas de negócio
  name          text not null check (length(trim(name)) between 1 and 200),
  -- preenchido pelo banco; não está nos grants de insert/update
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- garante que o workspace pertence ao tenant da linha
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade
);

-- ▸ índices sempre começando por workspace_id
create index __table___workspace_created_idx on public.__table__ (workspace_id, created_at desc);

create trigger __table___updated_at before update on public.__table__
  for each row execute function private.set_updated_at();

-- Privilégios explícitos. INSERT/UPDATE só nas colunas que o usuário pode
-- informar: tenant_id/workspace_id nunca mudam e created_by não é forjável.
revoke all on public.__table__ from anon, authenticated;
grant select, delete on public.__table__ to authenticated;
grant insert (tenant_id, workspace_id, name) on public.__table__ to authenticated;  -- ▸
grant update (name) on public.__table__ to authenticated;                          -- ▸

alter table public.__table__ enable row level security;

create policy __table___select on public.__table__ for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));

create policy __table___insert on public.__table__ for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));

create policy __table___update on public.__table__ for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id,
    array['manager', 'agent']::public.workspace_role[]));

create policy __table___delete on public.__table__ for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id,
    array['manager']::public.workspace_role[]));
