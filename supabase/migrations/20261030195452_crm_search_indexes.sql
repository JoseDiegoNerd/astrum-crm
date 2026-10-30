-- =============================================================================
-- Astrum · F1.6 · Índices de busca por trecho (pg_trgm)
--
-- A busca usa ILIKE '%termo%' (nome do contato/empresa/negócio e identificadores
-- de canal). Índices GIN de trigramas atendem esse padrão sem varrer a tabela.
-- No Supabase as extensões ficam no schema "extensions".
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create index contacts_name_trgm_idx on public.contacts
  using gin (name extensions.gin_trgm_ops);

create index contact_identities_identifier_trgm_idx on public.contact_identities
  using gin (identifier extensions.gin_trgm_ops);

create index companies_name_trgm_idx on public.companies
  using gin (name extensions.gin_trgm_ops);

create index deals_title_trgm_idx on public.deals
  using gin (title extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Busca de contatos
--
-- Com RLS ativa o Postgres não usa índices para operadores que não são
-- LEAKPROOF (ILIKE incluso): ele precisa aplicar a política antes do filtro do
-- usuário, e acaba varrendo a tabela. Esta função confere o acesso ao
-- workspace uma vez, explicitamente, e busca sem RLS — usando os índices.
-- A API ainda filtra o resultado sob RLS (defesa em profundidade).
-- -----------------------------------------------------------------------------
create function private.search_contact_ids(p_workspace_id uuid, p_term text, p_identifier_term text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name_pattern text;
  v_identifier_pattern text;
begin
  if not exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and private.can_access_workspace(w.tenant_id, w.id)
  ) then
    return;
  end if;

  -- termo é texto literal: escapa os curingas do LIKE
  v_name_pattern := '%' || replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_identifier_pattern := '%' || replace(replace(replace(p_identifier_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select c.id from public.contacts c
    where c.workspace_id = p_workspace_id and c.name ilike v_name_pattern
    union
    select i.contact_id from public.contact_identities i
    where i.workspace_id = p_workspace_id and i.identifier ilike v_identifier_pattern;
end;
$$;

grant execute on function private.search_contact_ids(uuid, text, text) to authenticated;
