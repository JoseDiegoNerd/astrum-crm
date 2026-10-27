---
name: astrum-nova-tabela
description: Cria ou altera tabelas de negócio do Astrum CRM com isolamento multi-tenant correto (tenant → workspace) — migration Supabase com tenant_id/workspace_id e FK composta, RLS com private.can_access_workspace/has_workspace_role, grants por coluna, espelho no schema Drizzle e testes de isolamento. Use SEMPRE que for criar tabela, coluna de dono/escopo, política RLS ou migration no Astrum (contatos, empresas, negócios, pipelines, conversas, mensagens, tarefas, notas, tags, canais, automações etc.), mesmo que o pedido fale só em "criar o módulo X", "adicionar entidade" ou "modelar Y" sem citar RLS.
---

# Nova tabela de negócio no Astrum

O Astrum é multi-tenant em dois níveis: **tenant** (quem paga) → **workspace** (onde se trabalha). Um vazamento entre clientes é o pior bug possível do produto, e a defesa principal é o banco: a API roda toda consulta como o próprio usuário (`withUserContext` em `packages/db/src/client.ts`), então quem decide o acesso é a RLS. Por isso toda tabela nova segue o mesmo molde, testado automaticamente.

Contexto completo: `docs/ARQUITETURA.md` §4 e §5. Núcleo de tenancy: `supabase/migrations/*_tenancy_core.sql`.

## Passo a passo

### 1. Decida o escopo da tabela
- **Dado de workspace** (quase tudo: contatos, negócios, conversas, mensagens…) → siga este guia.
- **Dado de conta** (plano, assinatura, faturas, uso agregado) → só `tenant_id`, políticas com `private.is_tenant_member` / `private.has_tenant_role`. Ver `tenants`/`memberships` na migration de tenancy.
- **Global** (catálogo de planos) → sem tenant; leitura liberada, escrita só por `service_role`.

### 2. Crie a migration
```bash
supabase migration new <nome_descritivo>
```
Nunca invente o nome do arquivo — o timestamp vem do CLI.

### 3. Parta do template
Copie `packages/db/templates/workspace-table.sql` para a migration, troque `__table__` e ajuste só o que está marcado com ▸. O template já traz, e você deve manter:

| Item | Por quê |
|---|---|
| `tenant_id` + `workspace_id` + FK composta para `workspaces (tenant_id, id)` | impede linha apontando para workspace de outro tenant; é o que torna seguro passar os dois ids às funções de política |
| `created_by default auth.uid()` fora dos grants | autoria não pode ser forjada |
| `revoke all` + grants explícitos | tabelas novas não são expostas por padrão no Supabase, e `UPDATE` só nas colunas editáveis impede mover a linha de tenant/workspace |
| `grant insert (colunas…)` | lista exatamente as colunas que o usuário informa — inclua toda coluna de negócio nova aqui |
| RLS ligada + 4 políticas (`select`/`insert`/`update`/`delete`) `to authenticated` | UPDATE precisa de política de SELECT; UPDATE precisa de `using` **e** `with check` |
| Funções `private.can_access_workspace(tenant_id, workspace_id)` e `private.has_workspace_role(tenant_id, workspace_id, roles)` | recebem os ids da própria linha, então funcionam também em `INSERT … RETURNING` |
| índices começando por `workspace_id` | toda consulta filtra por workspace |

Matriz de papéis padrão: **viewer** lê · **agent** cria/edita · **manager** também apaga · owner/admin do tenant = manager em todo workspace. Se a tabela precisar de outra regra (ex.: só manager edita pipelines), mude o array de papéis **e** ajuste o teste.

### 4. Relacionamentos entre tabelas de negócio
Referencie outra tabela de workspace pela FK composta, para nunca ligar dados de workspaces diferentes:
```sql
-- em deals, apontando para contacts
contact_id uuid,
foreign key (workspace_id, contact_id) references public.contacts (workspace_id, id) on delete set null (contact_id)
```
Para isso a tabela referenciada precisa de `unique (workspace_id, id)`.

### 5. Não faça
- `security definer` para "resolver" erro de permissão — ignora a RLS. Só no schema `private`, com `auth.uid()` no corpo, quando inevitável.
- Usar `user_metadata` / `raw_user_meta_data` em qualquer decisão de acesso — é editável pelo usuário.
- Views sem `with (security_invoker = true)` — views ignoram RLS por padrão.
- Consultar dados de negócio na API fora de `withUserContext`.

### 6. Espelhe no Drizzle
Adicione a tabela em `packages/db/src/schema.ts` (mesmos nomes de coluna; tipos `$inferSelect` exportados). A migration é a fonte da verdade; o Drizzle só tipa as consultas.

### 7. Teste o isolamento (obrigatório)
Crie `packages/db/test/<tabela>.test.ts`:
```ts
import { describeWorkspaceTable } from './workspace-table-suite.js';

describeWorkspaceTable({
  table: 'contacts',
  values: { name: 'Ana Souza' },   // colunas obrigatórias para um insert válido
  update: { name: 'Ana S.' },      // uma alteração permitida
});
```
A suíte cobre: agent cria/edita, viewer só lê, member fora do workspace não vê, owner/admin veem tudo, outro tenant não lê/altera/apaga/insere, FK composta barra workspace alheio, linha não troca de tenant/workspace, só manager apaga, `created_by` não é forjável, anon bloqueado. Se a tabela depende de outra (ex.: `deals` exige pipeline), use `setup` para criar o pré-requisito ou acrescente testes próprios no mesmo arquivo para regras específicas.

### 8. Verifique
```bash
pnpm --filter @astrum/db test        # PGlite em memória, sem Docker
pnpm typecheck
```
Com Supabase local rodando, rode também contra o Postgres real e os advisors:
```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:test
supabase db advisors
```

## Checklist final
- [ ] migration criada pelo CLI, baseada no template
- [ ] `tenant_id`, `workspace_id`, FK composta, índice por `workspace_id`
- [ ] `revoke all` + grants de insert/update por coluna
- [ ] RLS ligada e 4 políticas com as funções `private.*`
- [ ] FKs para outras tabelas de negócio via `(workspace_id, id)`
- [ ] tabela em `packages/db/src/schema.ts`
- [ ] `describeWorkspaceTable` + testes das regras específicas, todos passando
