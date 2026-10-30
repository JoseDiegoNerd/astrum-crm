-- =============================================================================
-- Astrum · F1.5 · Linha do tempo (activities)
--
-- Registro append-only do que aconteceu com contatos, empresas e negócios.
-- Usuários só LEEM (RLS por workspace); quem escreve são triggers das próprias
-- tabelas, que só disparam depois que a escrita do usuário passou pela RLS.
-- Por isso as funções abaixo são SECURITY DEFINER no schema private e não
-- recebem nada do usuário além da linha já gravada.
--
-- Exclusão do contato apaga o histórico dele (direito de eliminação — LGPD);
-- exclusão de negócio/empresa só desfaz o vínculo (o evento continua na ficha
-- do contato, com título/nome guardados no payload).
-- =============================================================================

create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  type          text not null check (type in (
                  'contact.created', 'company.created',
                  'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
                  'task.created', 'task.completed', 'note.added')),
  contact_id    uuid,
  deal_id       uuid,
  company_id    uuid,
  actor_id      uuid references public.profiles (id) on delete set null,
  payload       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, deal_id)
    references public.deals (workspace_id, id) on delete set null (deal_id),
  foreign key (workspace_id, company_id)
    references public.companies (workspace_id, id) on delete set null (company_id)
);

create index activities_contact_idx on public.activities (workspace_id, contact_id, occurred_at desc)
  where contact_id is not null;
create index activities_deal_idx on public.activities (workspace_id, deal_id, occurred_at desc)
  where deal_id is not null;
create index activities_company_idx on public.activities (workspace_id, company_id, occurred_at desc)
  where company_id is not null;

-- -----------------------------------------------------------------------------
-- Escrita (só via triggers)
-- -----------------------------------------------------------------------------
create function private.log_activity(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_type text,
  p_contact_id uuid,
  p_deal_id uuid,
  p_company_id uuid,
  p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activities (tenant_id, workspace_id, type, contact_id, deal_id, company_id, actor_id, payload)
  values (p_tenant_id, p_workspace_id, p_type, p_contact_id, p_deal_id, p_company_id,
          (select auth.uid()), p_payload);
$$;

create function private.activities_from_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(new.tenant_id, new.workspace_id, 'contact.created',
    new.id, null, new.company_id, jsonb_build_object('name', new.name));
  return null;
end;
$$;
create trigger contacts_activity after insert on public.contacts
  for each row execute function private.activities_from_contacts();

create function private.activities_from_companies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(new.tenant_id, new.workspace_id, 'company.created',
    null, null, new.id, jsonb_build_object('name', new.name));
  return null;
end;
$$;
create trigger companies_activity after insert on public.companies
  for each row execute function private.activities_from_companies();

create function private.activities_from_deals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text;
  v_from text;
  v_type text;
begin
  select s.name into v_to from public.pipeline_stages s where s.id = new.stage_id;

  if tg_op = 'INSERT' then
    perform private.log_activity(new.tenant_id, new.workspace_id, 'deal.created',
      new.contact_id, new.id, new.company_id,
      jsonb_build_object('title', new.title, 'stage', v_to,
                         'value_cents', new.value_cents, 'currency', new.currency));
    return null;
  end if;

  if new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  select s.name into v_from from public.pipeline_stages s where s.id = old.stage_id;
  v_type := case new.status
    when 'won' then 'deal.won'
    when 'lost' then 'deal.lost'
    else 'deal.stage_changed'
  end;
  perform private.log_activity(new.tenant_id, new.workspace_id, v_type,
    new.contact_id, new.id, new.company_id,
    jsonb_strip_nulls(jsonb_build_object(
      'title', new.title, 'from', v_from, 'to', v_to,
      'value_cents', new.value_cents, 'currency', new.currency,
      'reason', new.lost_reason)));
  return null;
end;
$$;
create trigger deals_activity after insert or update of stage_id on public.deals
  for each row execute function private.activities_from_deals();

create function private.activities_from_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.tenant_id, new.workspace_id, 'task.created',
      new.contact_id, new.deal_id, new.company_id,
      jsonb_strip_nulls(jsonb_build_object('title', new.title, 'due_at', new.due_at)));
  elsif old.done_at is null and new.done_at is not null then
    perform private.log_activity(new.tenant_id, new.workspace_id, 'task.completed',
      new.contact_id, new.deal_id, new.company_id,
      jsonb_build_object('title', new.title));
  end if;
  return null;
end;
$$;
create trigger tasks_activity after insert or update of done_at on public.tasks
  for each row execute function private.activities_from_tasks();

create function private.activities_from_notes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.log_activity(new.tenant_id, new.workspace_id, 'note.added',
    new.contact_id, new.deal_id, new.company_id,
    jsonb_build_object('note_id', new.id, 'excerpt', left(new.body, 200)));
  return null;
end;
$$;
create trigger notes_activity after insert on public.notes
  for each row execute function private.activities_from_notes();

-- funções de trigger e o helper não são chamáveis por usuários
revoke execute on function
  private.log_activity(uuid, uuid, text, uuid, uuid, uuid, jsonb),
  private.activities_from_contacts(),
  private.activities_from_companies(),
  private.activities_from_deals(),
  private.activities_from_tasks(),
  private.activities_from_notes()
from public, authenticated;

-- -----------------------------------------------------------------------------
-- Leitura
-- -----------------------------------------------------------------------------
revoke all on public.activities from anon, authenticated;
grant select on public.activities to authenticated;

alter table public.activities enable row level security;

create policy activities_select on public.activities for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
