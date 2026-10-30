# F1 — Núcleo do CRM · Especificação

> Status: **em andamento** — F1.1 a F1.4 implementadas (contatos, empresas, tags, campos customizados, funil, kanban, tarefas e notas) · Data: 2026-10-27 · Depende de: F0
> Toda tabela desta fase segue a skill `.claude/skills/astrum-nova-tabela`.

## 1. Objetivo

Dar ao time comercial de cada workspace o básico de um CRM: saber **quem** são os contatos e empresas, **em que pé** está cada negócio no funil, **o que** precisa ser feito e **o que aconteceu** com cada cliente. É também a base que o inbox omnichannel (F2) vai alimentar: cada conversa se liga a um contato pelas identidades de canal.

### Fora do escopo da F1
Mensagens e canais (F2), automações e IA (F4), cobrança (F5), relatórios avançados, permissões por campo, importação de outros CRMs (só CSV).

## 2. Modelo de dados

Todas as tabelas têm `id`, `tenant_id`, `workspace_id` (FK composta), `created_by`, `created_at`, `updated_at` — omitidos abaixo. `unique (workspace_id, id)` em tabelas referenciadas por outras.

### 2.1 Contatos e empresas
```
companies          name, document (CNPJ), domain, phone, owner_id → profiles,
                   custom jsonb, archived_at
contacts           name, type [lead|customer|other], company_id → companies,
                   owner_id → profiles, avatar_url, custom jsonb,
                   lgpd_status [unknown|consented|opted_out], archived_at
contact_identities contact_id → contacts (cascade), channel [phone|whatsapp|email|instagram|messenger|telegram|other],
                   identifier (normalizado), is_primary, verified
                   UNIQUE (workspace_id, channel, identifier)   ← base da deduplicação e do inbox
```
- Telefones normalizados em E.164 (padrão +55) e e-mails em minúsculas pela API **e** por `check` no banco.
- Contato não é apagado pelo agent: arquiva (`archived_at`). Exclusão definitiva (LGPD) só manager, e remove identidades em cascata.

### 2.2 Funil
```
pipelines          name, is_default, position
pipeline_stages    pipeline_id → pipelines (cascade), name, position, probability 0–100,
                   kind [open|won|lost]
deals              title, pipeline_id, stage_id, contact_id, company_id, owner_id,
                   value_cents bigint, currency char(3) default 'BRL',
                   expected_close_at date, status [open|won|lost] (derivado da etapa),
                   lost_reason, closed_at, position numeric (ordem no kanban), custom jsonb
```
- Todo workspace novo nasce com o pipeline **"Vendas"**: Novo → Qualificado → Proposta → Negociação → Ganho (won) → Perdido (lost). Criado por trigger em `workspaces`.
- Mover para etapa `won`/`lost` preenche `status` e `closed_at` (trigger); voltar para `open` limpa.
- `stage_id` precisa pertencer ao `pipeline_id` do negócio (FK composta `(pipeline_id, stage_id)`).
- Pipelines e etapas: só **manager** cria/edita/apaga. Etapa com negócios não pode ser apagada (mover antes).
- Negócios também recebem tags (`deal_tags`) e campos customizados (entidade `deal`).
- Limitação conhecida: mudar o *tipo* de uma etapa (ex.: aberta → ganho) não recalcula o status dos negócios que já estão nela; vale a partir do próximo movimento.

### 2.3 Trabalho do dia a dia
```
tasks              title, description, due_at, assignee_id → profiles, contact_id?, deal_id?, done_at
notes              body, contact_id?, deal_id?, company_id?   (ao menos um vínculo)
tags               name, color          UNIQUE (workspace_id, lower(name))
contact_tags / company_tags / deal_tags   (tag_id, <entidade>_id)   ← tabelas de junção com FK real
custom_field_defs  entity [contact|company|deal], key, label,
                   type [text|number|date|boolean|select|multiselect], options jsonb,
                   required, position         UNIQUE (workspace_id, entity, key)
```
- Notas: qualquer agent cria; **só o autor** edita; manager apaga.
- Campos customizados: definição só por manager; valores em `custom jsonb` validados pela API contra as definições.

### 2.4 Linha do tempo
```
activities         contact_id?, company_id?, deal_id?, type, actor_id, payload jsonb, occurred_at
```
- **Somente leitura** para usuários (sem grants de insert/update/delete): escrita apenas por triggers (`security definer` no schema `private`) em contatos, negócios, tarefas e notas.
- Tipos: `contact.created`, `deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost`, `task.created`, `task.completed`, `note.added`. A F2 acrescenta `message.*`.

## 3. Permissões (matriz)

| Recurso | viewer | agent | manager / admin / owner |
|---|---|---|---|
| Contatos, empresas, negócios | ler | criar, editar, arquivar | + apagar definitivo |
| Tarefas | ler | criar, editar, concluir | + apagar |
| Notas | ler | criar, editar as próprias | + apagar |
| Tags (aplicar) | — | sim | sim |
| Tags, campos custom, pipelines, etapas (configurar) | ler | ler | criar, editar, apagar |
| Linha do tempo | ler | ler | ler |

## 4. API (`/v1`, sempre com `X-Workspace-Id`)

| Recurso | Endpoints |
|---|---|
| Contatos | `GET /contacts?q=&type=&tag=&owner=&cursor=` · `POST /contacts` · `GET/PATCH /contacts/:id` · `POST /contacts/:id/archive` · `DELETE /contacts/:id` · `POST /contacts/:id/identities` · `DELETE /contacts/:id/identities/:identityId` · `POST /contacts/import` (CSV) |
| Empresas | `GET/POST /companies` · `GET/PATCH/DELETE /companies/:id` |
| Funil | `GET/POST /pipelines` · `PATCH/DELETE /pipelines/:id` · `POST/PATCH/DELETE /pipelines/:id/stages[/:stageId]` · `POST /pipelines/:id/stages/reorder` |
| Negócios | `GET /deals?pipeline=&stage=&owner=&status=` · `POST /deals` · `GET/PATCH/DELETE /deals/:id` · `POST /deals/:id/move` `{stageId, position}` |
| Tarefas | `GET /tasks?assignee=me&due=today|overdue|week` · `POST /tasks` · `PATCH/DELETE /tasks/:id` · `POST /tasks/:id/complete` |
| Notas | `GET /notes?contact=&deal=` · `POST /notes` · `PATCH/DELETE /notes/:id` |
| Tags | `GET/POST /tags` · `PATCH/DELETE /tags/:id` · `PUT /contacts/:id/tags` (idem deals, companies) |
| Campos custom | `GET/POST /custom-fields` · `PATCH/DELETE /custom-fields/:id` |
| Linha do tempo | `GET /timeline?contact=|deal=|company=&cursor=` |

Paginação por cursor (`created_at,id`), limite padrão 50. Erros do banco já mapeados pelo `DatabaseErrorFilter`.

## 5. Telas

1. **Contatos** — lista com busca (nome, telefone, e-mail), filtros (tipo, tag, responsável), criação rápida.
2. **Ficha do contato** — dados + campos custom, identidades de canal, empresa, negócios, tarefas, notas e linha do tempo numa coluna só.
3. **Empresas** — lista e ficha (contatos e negócios vinculados).
4. **Negócios (kanban)** — colunas por etapa, arrastar entre etapas, total por coluna, filtro por responsável; alternância para lista.
5. **Minhas tarefas** — hoje, atrasadas, próximos 7 dias; concluir com um clique.
6. **Configurações do workspace** — pipelines e etapas, tags, campos customizados.

## 6. Entregas em fatias

Cada fatia passa por: banco (skill `astrum-nova-tabela`) → API → tela → testes → revisão.

| Fatia | Conteúdo | Pronto quando |
|---|---|---|
| **F1.1** ✅ | contacts, contact_identities, companies + telas Contatos / Ficha / Empresas | contato com 2 identidades criado pela tela; identidade duplicada no workspace recusada com 409; outro workspace não vê |
| **F1.2** ✅ | tags, junções, custom_field_defs | filtro por tag funciona; campo custom obrigatório bloqueia salvar sem valor |
| **F1.3** ✅ | pipelines, stages, deals, pipeline padrão + kanban | workspace novo já tem "Vendas"; arrastar para "Ganho" marca won e `closed_at` |
| **F1.4** ✅ | tasks, notes + Minhas tarefas | tarefa atrasada aparece em "atrasadas"; agent não edita nota de outro |
| **F1.5** | activities + triggers + linha do tempo | criar contato, mover negócio e concluir tarefa aparecem na ficha, em ordem |
| **F1.6** | busca (pg_trgm) + importação CSV | busca por trecho de nome/telefone < 300 ms com 50 mil contatos; CSV de 5 mil linhas importa sem duplicar identidades |

## 7. Requisitos não funcionais
- Toda tabela com `describeWorkspaceTable` + testes das regras específicas (ex.: só autor edita nota).
- Listas p95 < 300 ms com 50 mil contatos / 20 mil negócios por workspace (índices por `workspace_id`).
- Nenhuma consulta de negócio fora de `withUserContext`.

## 8. Decisões em aberto
1. **Moeda:** só BRL na F1 ou multi-moeda já? (proposta: campo existe, UI só BRL)
2. **Contato em vários workspaces do mesmo tenant:** independentes (proposta, já decidido na arquitetura) — confirmar que agências não precisam de "contato global".
3. **Exclusão definitiva de contato (LGPD):** manager apaga direto, ou fluxo com confirmação e registro em auditoria? (proposta: confirmação + `audit_log` na F1.1)
