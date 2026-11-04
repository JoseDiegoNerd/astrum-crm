-- =============================================================================
-- Astrum · F2.1 · Inbox: canais, conversas, mensagens e eventos de webhook
-- Baseado em packages/db/templates/workspace-table.sql (skill astrum-nova-tabela).
-- Spec: docs/specs/F2-inbox-omnichannel.md
--
-- channels        configuração → só manager escreve. Segredos (credentials_enc,
--                 webhook_secret_hash) NUNCA são legíveis por usuários: sem grant
--                 de SELECT nessas colunas — só a conexão de serviço os lê.
-- conversations   agent atende (status, atribuir a si); manager atribui a qualquer um.
-- messages        imutáveis para usuários: agent só insere saídas "queued";
--                 status e entradas são gravados pelo serviço (webhook/worker).
-- inbound_events  só o serviço (sem grants, sem políticas).
-- =============================================================================

create type public.channel_type as enum ('whatsapp', 'email', 'instagram', 'messenger', 'telegram', 'webchat');
create type public.channel_status as enum ('pending', 'connected', 'error', 'disabled');
create type public.conversation_status as enum ('open', 'pending', 'resolved');
create type public.message_direction as enum ('in', 'out');
create type public.message_sender as enum ('contact', 'user', 'system');
create type public.message_type as enum (
  'text', 'image', 'audio', 'video', 'document', 'sticker', 'location',
  'template', 'interactive', 'unsupported');
create type public.message_status as enum ('received', 'queued', 'sent', 'delivered', 'read', 'failed');
create type public.inbound_event_status as enum ('pending', 'processed', 'failed', 'ignored');

-- -----------------------------------------------------------------------------
-- channels
-- -----------------------------------------------------------------------------
create table public.channels (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  workspace_id         uuid not null,
  type                 public.channel_type not null,
  name                 text not null check (length(trim(name)) between 1 and 80),
  status               public.channel_status not null default 'pending',
  -- ex.: WhatsApp Business Account ID
  external_account_id  text,
  -- ex.: phone_number_id do WhatsApp; é por ele que o webhook acha o canal
  external_id          text,
  -- ex.: "+55 11 99999-0000", para exibir
  display_identifier   text,
  config               jsonb not null default '{}'::jsonb,
  credentials_enc      bytea,
  webhook_secret_hash  text,
  last_error           text,
  connected_at         timestamptz,
  created_by           uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, id),
  unique (type, external_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade
);
create index channels_workspace_idx on public.channels (workspace_id, type);

create trigger channels_updated_at before update on public.channels
  for each row execute function private.set_updated_at();

-- alvo da FK (workspace_id, identity_id) das conversas
alter table public.contact_identities
  add constraint contact_identities_workspace_id_id_key unique (workspace_id, id);

-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  workspace_id      uuid not null,
  channel_id        uuid not null,
  contact_id        uuid not null,
  identity_id       uuid,
  status            public.conversation_status not null default 'open',
  assignee_id       uuid,
  subject           text check (length(subject) <= 200),
  last_message_at   timestamptz,
  -- base da janela de 24 h do WhatsApp
  last_inbound_at   timestamptz,
  last_outbound_at  timestamptz,
  unread_count      integer not null default 0 check (unread_count >= 0),
  resolved_at       timestamptz,
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, id),
  -- alvo da FK (conversation_id, channel_id) das mensagens
  unique (id, channel_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  -- canal com conversas não é apagado (desative-o)
  foreign key (workspace_id, channel_id)
    references public.channels (workspace_id, id) on delete restrict,
  -- apagar o contato apaga as conversas dele (eliminação — LGPD)
  foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id) on delete cascade,
  foreign key (workspace_id, identity_id)
    references public.contact_identities (workspace_id, id) on delete set null (identity_id),
  foreign key (tenant_id, assignee_id)
    references public.memberships (tenant_id, user_id) on delete set null (assignee_id)
);

-- uma conversa aberta (ou pendente) por canal e contato
create unique index conversations_one_active_key on public.conversations (channel_id, contact_id)
  where status <> 'resolved';
create index conversations_inbox_idx on public.conversations (workspace_id, status, last_message_at desc);
create index conversations_assignee_idx on public.conversations (workspace_id, assignee_id, last_message_at desc)
  where status <> 'resolved';
create index conversations_contact_idx on public.conversations (workspace_id, contact_id, created_at desc);

create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

-- resolved_at acompanha o status
create function private.conversations_sync_resolved()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status <> 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
create trigger conversations_sync_resolved before insert or update of status on public.conversations
  for each row execute function private.conversations_sync_resolved();

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  workspace_id     uuid not null,
  conversation_id  uuid not null,
  channel_id       uuid not null,
  direction        public.message_direction not null,
  sender_type      public.message_sender not null,
  sender_id        uuid default auth.uid() references public.profiles (id) on delete set null,
  type             public.message_type not null default 'text',
  body             text check (length(body) <= 4096),
  content          jsonb not null default '{}'::jsonb,
  external_id      text,
  reply_to_id      uuid,
  status           public.message_status not null default 'queued',
  error            jsonb,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, id),
  unique (channel_id, external_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, conversation_id)
    references public.conversations (workspace_id, id) on delete cascade,
  -- a mensagem é do mesmo canal da conversa
  foreign key (conversation_id, channel_id)
    references public.conversations (id, channel_id) on delete cascade,
  foreign key (workspace_id, reply_to_id)
    references public.messages (workspace_id, id) on delete set null (reply_to_id),
  -- entrada vem do contato; saída do usuário ou do sistema
  constraint messages_direction_sender_check check (
    (direction = 'in' and sender_type = 'contact') or (direction = 'out' and sender_type <> 'contact'))
);
create index messages_conversation_idx on public.messages (workspace_id, conversation_id, created_at desc);

create trigger messages_updated_at before update on public.messages
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- inbound_events — payload bruto de webhooks, para idempotência e reprocessamento
-- -----------------------------------------------------------------------------
create table public.inbound_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  workspace_id  uuid not null,
  channel_id    uuid not null,
  external_id   text not null,
  payload       jsonb not null,
  status        public.inbound_event_status not null default 'pending',
  attempts      integer not null default 0,
  error         text,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  unique (channel_id, external_id),
  foreign key (tenant_id, workspace_id)
    references public.workspaces (tenant_id, id) on delete cascade,
  foreign key (workspace_id, channel_id)
    references public.channels (workspace_id, id) on delete cascade
);
create index inbound_events_pending_idx on public.inbound_events (received_at) where status = 'pending';

-- -----------------------------------------------------------------------------
-- Privilégios
-- -----------------------------------------------------------------------------
revoke all on public.channels, public.conversations, public.messages, public.inbound_events
  from anon, authenticated;

-- channels: segredos fora do SELECT; escrita deles permitida (só manager, pela RLS)
grant select (id, tenant_id, workspace_id, type, name, status, external_account_id, external_id,
              display_identifier, config, last_error, connected_at, created_by, created_at, updated_at)
  on public.channels to authenticated;
grant insert (tenant_id, workspace_id, type, name, external_account_id, external_id, display_identifier,
              config, credentials_enc, webhook_secret_hash)
  on public.channels to authenticated;
grant update (name, status, external_account_id, external_id, display_identifier, config,
              credentials_enc, webhook_secret_hash)
  on public.channels to authenticated;
grant delete on public.channels to authenticated;

grant select, delete on public.conversations to authenticated;
grant insert (tenant_id, workspace_id, channel_id, contact_id, identity_id, assignee_id, subject)
  on public.conversations to authenticated;
grant update (status, assignee_id, subject, unread_count) on public.conversations to authenticated;

grant select on public.messages to authenticated;
grant insert (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type, type, body,
              content, reply_to_id)
  on public.messages to authenticated;

-- inbound_events: nenhum privilégio para usuários

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.channels enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.inbound_events enable row level security;

create policy channels_select on public.channels for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy channels_insert on public.channels for insert to authenticated
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy channels_update on public.channels for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));
create policy channels_delete on public.channels for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy conversations_select on public.conversations for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
create policy conversations_insert on public.conversations for insert to authenticated
  with check (
    private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[])
    or (private.has_workspace_role(tenant_id, workspace_id, array['agent']::public.workspace_role[])
        and (assignee_id is null or assignee_id = (select auth.uid()))));
create policy conversations_update on public.conversations for update to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]))
  with check (private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));

-- Agent pode pegar a conversa para si ou soltá-la; só manager a passa para outra
-- pessoa. Precisa comparar antes/depois, por isso é trigger e não política.
-- Sem usuário (conexão de serviço: webhook/worker), não há restrição.
create function private.conversations_check_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_id is not null
     and new.assignee_id <> (select auth.uid())
     and not private.has_workspace_role(new.tenant_id, new.workspace_id, array['manager']::public.workspace_role[])
  then
    raise exception 'Só managers atribuem conversas a outras pessoas' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger conversations_check_assignment before update of assignee_id on public.conversations
  for each row execute function private.conversations_check_assignment();

create policy conversations_delete on public.conversations for delete to authenticated
  using (private.has_workspace_role(tenant_id, workspace_id, array['manager']::public.workspace_role[]));

create policy messages_select on public.messages for select to authenticated
  using (private.can_access_workspace(tenant_id, workspace_id));
-- usuário só cria mensagem de saída, em nome próprio (sender_id = auth.uid() pelo default)
create policy messages_insert on public.messages for insert to authenticated
  with check (
    direction = 'out' and sender_type = 'user'
    and private.has_workspace_role(tenant_id, workspace_id, array['manager', 'agent']::public.workspace_role[]));
