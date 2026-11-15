-- =============================================================================
-- Astrum · F2.3 · Envio de mensagens
--
-- A tabela messages é a fila de saída: o atendente grava a mensagem "queued"
-- (sob RLS) e o worker de serviço a envia pelo provedor, com novas tentativas.
-- Colunas de controle de envio não têm grant para usuários.
-- =============================================================================

alter table public.messages
  add column send_attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now();

create index messages_outbound_queue_idx on public.messages (next_attempt_at)
  where status = 'queued' and direction = 'out';

-- Saída só em conversa ativa: em conversa resolvida o atendente reabre antes
-- (a reabertura respeita "uma conversa ativa por contato e canal").
create function private.messages_check_conversation_active()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.direction = 'out' and exists (
    select 1 from public.conversations c where c.id = new.conversation_id and c.status = 'resolved'
  ) then
    raise exception 'Conversa resolvida: reabra a conversa para responder' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger messages_check_conversation_active before insert on public.messages
  for each row execute function private.messages_check_conversation_active();

-- Mensagem de saída atualiza a conversa (o usuário não tem grant nessas colunas).
create function private.messages_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'out' then
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
           last_outbound_at = greatest(coalesce(last_outbound_at, new.created_at), new.created_at),
           -- quem responde já leu a conversa
           unread_count = 0
     where id = new.conversation_id;
  end if;
  return null;
end;
$$;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function private.messages_touch_conversation();

revoke execute on function private.messages_touch_conversation() from public, authenticated;
