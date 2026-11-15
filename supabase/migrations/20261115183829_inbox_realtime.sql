-- =============================================================================
-- Astrum · F2.4 · Inbox em tempo real
--
-- Conversas e mensagens entram na publicação do Supabase Realtime. O Realtime
-- aplica a RLS de cada usuário conectado (políticas de SELECT), então cada
-- atendente só recebe eventos dos workspaces que acessa. As colunas secretas de
-- channels não são publicadas (a tabela channels fica de fora).
--
-- Fora do Supabase (ex.: Postgres de testes) a publicação não existe: pula.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.conversations, public.messages;
  end if;
end;
$$;
