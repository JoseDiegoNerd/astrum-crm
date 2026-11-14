-- =============================================================================
-- Astrum · F2.2 · Fila de entrada no Postgres + eventos de conversa
--
-- inbound_events vira a fila de processamento dos webhooks: o worker pega
-- eventos pendentes com FOR UPDATE SKIP LOCKED (vários workers sem disputa),
-- e falhas voltam para a fila com espera crescente (next_attempt_at).
-- Redis/BullMQ só quando o volume pedir (ver docs/ARQUITETURA.md).
-- =============================================================================

alter table public.inbound_events
  add column next_attempt_at timestamptz not null default now();

drop index public.inbound_events_pending_idx;
create index inbound_events_pending_idx on public.inbound_events (next_attempt_at)
  where status = 'pending';

-- Linha do tempo: abertura e encerramento de conversas (não uma linha por
-- mensagem, para não poluir a ficha do contato).
alter table public.activities drop constraint activities_type_check;
alter table public.activities add constraint activities_type_check check (type in (
  'contact.created', 'company.created',
  'deal.created', 'deal.stage_changed', 'deal.won', 'deal.lost',
  'task.created', 'task.completed', 'note.added',
  'conversation.opened', 'conversation.resolved'));

alter table public.activities add column conversation_id uuid;
alter table public.activities
  add constraint activities_conversation_fkey foreign key (workspace_id, conversation_id)
  references public.conversations (workspace_id, id) on delete set null (conversation_id);

create function private.activities_from_conversations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel text;
begin
  select c.name into v_channel from public.channels c where c.id = new.channel_id;
  if tg_op = 'INSERT' then
    insert into public.activities (tenant_id, workspace_id, type, contact_id, conversation_id, actor_id, payload)
    values (new.tenant_id, new.workspace_id, 'conversation.opened', new.contact_id, new.id,
            (select auth.uid()), jsonb_build_object('channel', v_channel));
  elsif new.status = 'resolved' and old.status <> 'resolved' then
    insert into public.activities (tenant_id, workspace_id, type, contact_id, conversation_id, actor_id, payload)
    values (new.tenant_id, new.workspace_id, 'conversation.resolved', new.contact_id, new.id,
            (select auth.uid()), jsonb_build_object('channel', v_channel));
  end if;
  return null;
end;
$$;
create trigger conversations_activity after insert or update of status on public.conversations
  for each row execute function private.activities_from_conversations();

revoke execute on function private.activities_from_conversations() from public, authenticated;
