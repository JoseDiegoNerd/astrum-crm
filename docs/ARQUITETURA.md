# Astrum CRM — Arquitetura v0.2

> Status: **decisões principais tomadas** (ver §12) · Data: 2026-10-27
> Referência conceitual: Ever Gauzy (AGPL-3.0) — usado **apenas como inspiração**; nenhum código copiado.

---

## 1. Requisitos

### 1.1 Funcionais
| Módulo | Escopo |
|---|---|
| **Contas (multi-tenant)** | Cada cliente pagante é um *tenant*; dentro dele, um ou mais *workspaces* (marcas, filiais ou clientes de uma agência), cada um com seus contatos, canais e pipelines. |
| **Contatos & Empresas** | Cadastro único de pessoa (lead → cliente), várias identidades por canal (telefone, e-mail, @instagram…), tags, campos customizados. |
| **Vendas** | Pipelines configuráveis → etapas → negócios (valor, moeda, responsável, ganho/perdido), tarefas e notas. |
| **Inbox omnichannel** | Todas as conversas (WhatsApp, Instagram, Messenger, e-mail, webchat, Telegram, SMS) numa caixa só, com atribuição, filas, status e SLA. |
| **Linha do tempo** | Histórico unificado do contato: mensagens, negócios, tarefas, notas, mudanças de etapa. |
| **Automações** | Gatilho → condições → ações (ex.: “mensagem nova sem dono há 5 min → atribuir round-robin”). |
| **IA** | Resumo de conversa, sugestão de resposta, classificação de intenção, transcrição de áudio, chatbot de triagem. |
| **Integrações** | API pública REST, webhooks de saída, Zapier/Make/n8n. |
| **Planos** | Assinatura, limites por plano (usuários, canais, mensagens IA) e módulos liberados por plano. |

### 1.2 Não funcionais
- **Latência do inbox:** mensagem recebida aparece na tela em < 2 s (p95).
- **Webhooks de canais:** responder 200 em < 500 ms (Meta reenvia/derruba se demorar).
- **Idempotência:** o mesmo evento de canal nunca gera mensagem duplicada.
- **Isolamento:** um tenant jamais enxerga dado de outro (defesa em profundidade: aplicação + RLS no banco).
- **LGPD:** consentimento por canal, exportação e anonimização de contato, log de auditoria.
- **Disponibilidade alvo:** 99,5% no início.

### 1.3 Premissas (validar)
- Equipe pequena (1–4 devs), TypeScript como linguagem única.
- Escala inicial: até ~200 tenants, ~1 M mensagens/mês no total.
- Mercado Brasil → WhatsApp é o canal nº 1; uso da **WhatsApp Cloud API oficial** (sem bibliotecas não oficiais, por risco de banimento).

---

## 2. Stack escolhida

| Camada | Escolha | Por quê |
|---|---|---|
| Monorepo | **pnpm + Turborepo** | Compartilhar tipos/SDK entre web, API e workers. |
| Web | **Next.js (App Router) + React + Tailwind + shadcn/ui** | Ecossistema forte, SSR para páginas públicas (webchat, agendamento). |
| API | **NestJS** | Módulos, DI e guards — mesmo padrão modular do Gauzy, bom para plugins. |
| Workers | **NestJS standalone + BullMQ (Redis)** | Filas para envio/recebimento de mensagens, automações, IA. |
| Banco | **PostgreSQL** (gerenciado via **Supabase**) | RLS para multi-tenant, JSONB para campos custom, FTS para busca. |
| Auth | **Supabase Auth** (JWT validado na API) | E-mail/senha, magic link, Google; SSO corporativo depois. |
| Realtime | **Supabase Realtime** (broadcast por tenant/conversa) | Evita manter servidor de WebSocket próprio no início. |
| Arquivos | **Supabase Storage** (S3-compatível) | Mídias de WhatsApp/Instagram, anexos. |
| ORM | **Drizzle** (só consultas tipadas) | SQL explícito; as migrations são SQL puro em `supabase/migrations` (Supabase CLI). |
| IA | **Claude API** atrás de interface `AiProvider` | Sonnet para respostas/resumos, Haiku para classificação barata. |
| Mobile (fase 5) | **Expo / React Native** | Reaproveita SDK e tipos. |
| Observabilidade | **Sentry + PostHog + logs estruturados (pino)** | Erros, produto e auditoria técnica. |
| Hospedagem web | **Vercel** (funções na região `gru1`, São Paulo) | Deploy nativo do Next.js, preview por branch. |
| Hospedagem API/worker | **Fly.io** (região `gru`, São Paulo), containers Docker | Processos de longa duração (workers BullMQ) ao lado do banco; migra para AWS sem reescrever. |
| Supabase | Região **`sa-east-1` (São Paulo)** | Latência baixa para usuários e para a API. |
| Redis | **Upstash** (plano de preço fixo, `sa-east-1`) ou Redis em máquina Fly | BullMQ faz muitas chamadas; evitar plano por requisição. |
| Cobrança | **Asaas** atrás de interface `BillingProvider` | Assinatura recorrente com Pix, boleto e cartão + emissão de NFS-e. Stripe fica para clientes internacionais. |

> **Trade-off principal:** Supabase acelera muito (auth, realtime, storage, RLS prontos), mas cria dependência de fornecedor. Mitigação: a API conversa com Postgres via Drizzle (SQL padrão) e Auth/Realtime/Storage ficam atrás de interfaces próprias — trocáveis por Keycloak/Socket.IO/S3 se necessário.

---

## 3. Visão geral dos componentes

```
                       ┌──────────────────────────────────────────┐
  Usuários ───────────▶│  apps/web (Next.js)                      │
  (atendentes/vendas)  │  CRM · Inbox · Pipelines · Config        │
                       └───────┬───────────────────▲──────────────┘
                               │ REST (JWT)        │ Realtime (broadcast)
                               ▼                   │
                       ┌───────────────────┐   ┌───┴───────────────┐
  Visitantes ─webchat─▶│  apps/api (NestJS)│   │ Supabase Realtime │
                       │  módulos de domínio│   └───▲───────────────┘
  Meta / Telegram /    │  + Webhook Gateway │       │
  E-mail / SMS ──────▶ │  /webhooks/:canal  │       │
                       └──┬────────┬────────┘       │
                          │        │ enfileira      │ publica eventos
                          │        ▼                │
                          │   ┌──────────┐   ┌──────┴────────────────┐
                          │   │  Redis   │◀─▶│ apps/worker (BullMQ)  │
                          │   │ (filas)  │   │ inbound · outbound ·  │
                          │   └──────────┘   │ automações · IA ·     │
                          │                  │ webhooks de saída     │
                          ▼                  └──┬──────────┬─────────┘
                   ┌───────────────────────┐    │          │
                   │ PostgreSQL (RLS)      │◀───┘          ▼
                   │ Storage (mídias)      │       Adaptadores de canal ──▶ APIs externas
                   └───────────────────────┘       (WhatsApp, IG, e-mail…)    + Claude API
```

### Estrutura do monorepo
```
astrum/
├─ apps/
│  ├─ web/            Next.js
│  ├─ api/            NestJS (REST + webhooks)
│  └─ worker/         NestJS standalone (BullMQ)
├─ packages/
│  ├─ db/             schema Drizzle, migrations, políticas RLS
│  ├─ domain/         tipos e regras de negócio puras
│  ├─ channels/       interface ChannelProvider + adaptadores
│  │   ├─ whatsapp-cloud/
│  │   ├─ instagram/  messenger/  email/  webchat/  telegram/  sms/
│  ├─ ai/             interface AiProvider + adaptador Claude
│  ├─ sdk/            cliente tipado da API (web, mobile, terceiros)
│  └─ ui/             componentes compartilhados
└─ docs/
```

---

## 4. Multi-tenancy

Dois níveis, como o `tenant` + `organization` do Gauzy:

```
tenant  (quem paga: plano, assinatura, faturas, limites, usuários)
 └─ workspace  (onde se trabalha: contatos, canais, pipelines, inbox, automações)
     └─ teams  (filas de atendimento / equipes de venda)
```

| Nível | Exemplos | Dono de |
|---|---|---|
| **Tenant** | “Agência XYZ”, “Rede de Clínicas ABC” | Plano, cobrança, usuários, limites globais, auditoria. |
| **Workspace** | “Cliente Padaria Sol”, “Clínica Unidade Centro” | Contatos, empresas, negócios, canais, conversas, templates, automações, campos custom. |

Regras:
- Modelo **banco único, schema único**. Toda tabela de negócio tem **`tenant_id` e `workspace_id`**; tabelas de conta (planos, assinaturas, usuários) só `tenant_id`.
- **Dados não cruzam workspaces**: o mesmo telefone pode ser contato em dois workspaces, como registros independentes (`UNIQUE (workspace_id, channel_type, identifier)`).
- **Acesso:** `memberships` dá o papel no tenant (`owner`/`admin` veem todos os workspaces); `workspace_members` dá acesso e papel por workspace aos demais (`manager`/`agent`/`viewer`).
- **Duas camadas de proteção:**
  1. API: um `WorkspaceGuard` lê o JWT + header `X-Workspace-Id` e só deixa passar se o usuário enxerga aquele workspace.
  2. Banco: **RLS** baseada em `auth.uid()`. A API abre cada transação com `role = authenticated` e as claims do JWT (`withUserContext` em `packages/db`), exatamente como a Data API do Supabase — então as mesmas políticas protegem a API, o Realtime e qualquer acesso direto.
- Políticas de tabelas de negócio usam `private.can_access_workspace(tenant_id, workspace_id)` e `private.has_workspace_role(tenant_id, workspace_id, roles)`; a FK composta `(tenant_id, workspace_id) → workspaces(tenant_id, id)` garante que o par é consistente.
- `UPDATE` liberado só nas colunas editáveis (grants por coluna): uma linha nunca muda de tenant/workspace.
- Workers usam `service_role` (ignora RLS) e por isso **sempre** filtram por `workspace_id` explicitamente; toda tarefa enfileirada carrega `tenant_id` e `workspace_id`.
- Índices compostos começando por `(workspace_id, …)`.

Implementação F0: `supabase/migrations/*_tenancy_core.sql`, testes em `packages/db/test/isolation.test.ts`.
- Limites do plano valem no **tenant** (nº de workspaces, usuários, canais, mensagens de IA), somando todos os workspaces.
- Plano básico = 1 workspace criado automaticamente; o usuário nem percebe o segundo nível até precisar dele.

---

## 5. Modelo de dados (núcleo)

Todas as tabelas abaixo têm `id uuid`, `tenant_id uuid`, `created_at`, `updated_at`. As tabelas das seções 5.2 a 5.4 têm também **`workspace_id uuid`**, exceto onde marcado *(tenant)* ou *(global)*. Essas colunas estão omitidas para brevidade.

### 5.1 Identidade e acesso
```
tenants          (name, slug, plan_id, settings jsonb, status)   -- (global)
workspaces       (name, slug, timezone, locale, settings jsonb, archived_at)  -- (tenant)
profiles         (id = auth.users.id, name, email, avatar_url)   -- (global) criado por trigger
memberships      (user_id, role[owner|admin|member], status)     -- (tenant)
workspace_members (workspace_id, user_id, role[manager|agent|viewer])  -- (tenant)
teams            (workspace_id, name)       team_members (team_id, user_id)
api_keys         (workspace_id nullable, name, hash, scopes[], last_used_at)  -- (tenant)
audit_log        (workspace_id nullable, actor_id, action, entity, entity_id, diff jsonb, ip)  -- (tenant)
```

### 5.2 CRM
```
contacts         (name, type[lead|customer|other], owner_id, company_id,
                  avatar_url, custom jsonb, lgpd_status, deleted_at)
contact_identities (contact_id, channel_type, identifier, verified)
                  UNIQUE (workspace_id, channel_type, identifier)   -- ex.: whatsapp:+5511999999999
companies        (name, document, domain, custom jsonb)
pipelines        (name, is_default)
pipeline_stages  (pipeline_id, name, position, probability, kind[open|won|lost])
deals            (title, pipeline_id, stage_id, contact_id, company_id, owner_id,
                  value_cents, currency, expected_close_at, status, lost_reason, custom jsonb)
tasks            (title, due_at, assignee_id, subject_type, subject_id, done_at)
notes            (body, author_id, subject_type, subject_id)
tags             (name, color)             taggings (tag_id, subject_type, subject_id)
custom_field_defs (entity[contact|company|deal], key, label, type, options jsonb, required)
activities       (contact_id, deal_id, type, actor_type, actor_id, payload jsonb, occurred_at)
                  -- linha do tempo unificada (append-only)
```

### 5.3 Omnichannel
```
channels         (type[whatsapp|instagram|messenger|email|webchat|telegram|sms],
                  provider, name, credentials_enc bytea, config jsonb,
                  status[connected|error|disconnected], external_account_id)
inbound_events   (channel_id, external_event_id, raw jsonb, status, error, received_at)
                  UNIQUE (channel_id, external_event_id)          -- idempotência
conversations    (channel_id, contact_id, status[open|pending|snoozed|resolved],
                  assignee_id, team_id, priority, last_message_at,
                  last_inbound_at,           -- controla janela de 24h do WhatsApp
                  first_response_at, sla_due_at, unread_count)
messages         (conversation_id, direction[in|out], sender_type[contact|user|bot|system],
                  sender_id, type[text|image|audio|video|document|location|template|interactive],
                  content jsonb, external_id, status[queued|sent|delivered|read|failed],
                  error jsonb, ai_meta jsonb, sent_at)
                  UNIQUE (channel_id, external_id)
                  -- particionar por mês quando passar de ~50 M linhas
attachments      (message_id, storage_path, mime, size, transcription text)
message_templates (channel_id, name, language, category, components jsonb,
                  provider_status[pending|approved|rejected])    -- templates HSM do WhatsApp
canned_responses (shortcut, body, team_id)
consents         (contact_id, channel_type, status[opt_in|opt_out], source, at)
```

### 5.4 Automação, integrações e planos
```
automations      (name, trigger, conditions jsonb, actions jsonb, enabled, run_count)
automation_runs  (automation_id, subject_id, status, log jsonb)
webhook_endpoints (url, events[], secret, enabled)
webhook_deliveries (endpoint_id, event, payload, status, attempts, next_retry_at)
plans            (code, limits jsonb, features[])                 -- (global)
subscriptions    (plan_id, provider[asaas|stripe], external_customer_id,
                  external_subscription_id, payment_method[pix|boleto|card],
                  status, current_period_end)                      -- (tenant)
invoices         (subscription_id, external_id, amount_cents, due_at, paid_at,
                  status, nfse_number, nfse_url)                   -- (tenant)
usage_counters   (workspace_id, metric, period, value)            -- (tenant) somado para limites
```

---

## 6. Canais: padrão de adaptador

Inspirado no padrão `email-provider-*` / `ai-provider-*` do Gauzy: **uma interface, vários provedores.**

```ts
// packages/channels/src/channel-provider.ts
export interface ChannelProvider {
  readonly type: ChannelType;

  /** Valida assinatura (ex.: X-Hub-Signature-256) e converte o payload bruto. */
  parseWebhook(req: RawWebhook, channel: Channel): Promise<NormalizedEvent[]>;

  /** Envia mensagem já normalizada; retorna o id externo. */
  send(channel: Channel, msg: OutboundMessage): Promise<{ externalId: string }>;

  /** Baixa mídia do provedor para o nosso storage. */
  fetchMedia(channel: Channel, ref: MediaRef): Promise<Readable>;

  /** Regras de envio do canal (janela de 24h, tipos suportados, limites). */
  capabilities(channel: Channel): ChannelCapabilities;

  /** Conectar / reconectar (OAuth, Embedded Signup da Meta, IMAP…). */
  connect?(input: ConnectInput): Promise<ChannelCredentials>;
}

export type NormalizedEvent =
  | { kind: 'message'; externalId: string; from: Identity; message: InboundMessage; at: Date }
  | { kind: 'status';  externalId: string; status: MessageStatus; error?: unknown; at: Date };
```

| Canal | Provedor inicial | Observação |
|---|---|---|
| WhatsApp | **Cloud API (Meta)** via Embedded Signup | Janela de 24 h: fora dela só **templates aprovados**. |
| Instagram / Messenger | Graph API da Meta | Mesmo app Meta do WhatsApp; janela de 24 h (+ tag humana de 7 dias). |
| E-mail | Entrada via **Postmark/SendGrid inbound** ou IMAP; saída via SES/Resend | Threading por `Message-ID`/`In-Reply-To`. |
| Webchat | Próprio (widget JS + Realtime) | Identifica visitante por cookie; pede e-mail/telefone para unificar. |
| Telegram | Bot API | Simples, bom para validar a abstração. |
| SMS | Twilio / Zenvia | Baixa prioridade. |

---

## 7. Fluxos principais

### 7.1 Mensagem recebida (ex.: WhatsApp)
```
Meta ──POST /webhooks/whatsapp/:channelId──▶ API
  1. valida assinatura HMAC                    (falhou → 401)
  2. INSERT inbound_events ON CONFLICT DO NOTHING (idempotência)
  3. enfileira job "inbound" e responde 200    (< 500 ms)
Worker "inbound":
  4. adapter.parseWebhook → eventos normalizados
  5. upsert contact_identity → contact (cria lead se novo)
  6. acha conversa aberta do contato no canal, ou cria
  7. INSERT message (UNIQUE external_id) + atualiza last_inbound_at, unread_count
  8. mídia? → job "media" baixa para Storage (+ transcrição de áudio)
  9. INSERT activity (linha do tempo)
 10. publica no Realtime: workspace:{id}:inbox e conversation:{id}
 11. dispara avaliação de automações (job "automation")
```

### 7.2 Mensagem enviada pelo atendente
```
Web ──POST /conversations/:id/messages──▶ API
  1. checa permissão + capabilities (janela 24h? exige template?)
  2. INSERT message status=queued → retorna 202 (UI mostra “enviando”)
  3. job "outbound" (retry exponencial, 5 tentativas)
Worker:
  4. adapter.send → grava external_id, status=sent
  5. webhooks de status do provedor → delivered/read/failed → Realtime
```

### 7.3 IA
- **Sugestão de resposta:** contexto = últimas N mensagens + dados do contato/negócio + base de conhecimento do tenant → Claude → rascunho para o atendente aprovar (nunca envia sozinho no início).
- **Resumo** ao resolver conversa → grava em `activities`.
- **Classificação** (intenção, sentimento, urgência) com modelo mais barato → alimenta automações e roteamento.
- **Chatbot de triagem** (fase 4): coleta dados e passa para humano.
- Tudo contabilizado em `usage_counters` para limitar por plano.

---

## 8. API

- **REST** versionada (`/v1`), OpenAPI gerado pelo NestJS → `packages/sdk` gerado a partir dele.
- Recursos: `/contacts`, `/companies`, `/deals`, `/pipelines`, `/conversations`, `/conversations/:id/messages`, `/channels`, `/automations`, `/webhooks`, `/tasks`.
- Paginação por cursor, filtros por query, `Idempotency-Key` em POSTs críticos.
- Autenticação: JWT (usuários) ou API key (integrações), sempre escopado ao tenant.
- **Webhooks de saída** assinados (HMAC) para `contact.created`, `deal.stage_changed`, `message.received`, etc. — base para Zapier/Make/n8n.

---

## 9. Segurança e LGPD

- Credenciais de canais criptografadas (`credentials_enc`, chave em KMS/variável segura, nunca no banco em claro).
- RLS + testes automatizados de isolamento entre tenants (obrigatórios no CI).
- `consents` por canal; opt-out (“SAIR”) processado automaticamente.
- Exportar/anonimizar contato (direitos do titular); `audit_log` para ações administrativas.
- Rate limit por tenant e por API key.

---

## 10. Escala e operação

| Ponto | Agora | Quando crescer |
|---|---|---|
| Banco | Postgres gerenciado único | Particionar `messages` por mês; réplica de leitura para relatórios. |
| Busca | Postgres FTS + `pg_trgm` | OpenSearch/Meilisearch para busca em mensagens. |
| Filas | Postgres (`inbound_events` com `SKIP LOCKED`) — decisão da F2.2 | BullMQ/Redis com filas por prioridade/canal e workers escalados por fila. |
| Realtime | Supabase Realtime | Socket.IO próprio + Redis adapter se custo/limites apertarem. |
| Relatórios | Views/materialized views | Data warehouse (ClickHouse/BigQuery) via CDC. |

Monitorar: atraso das filas, taxa de falha de envio por canal, tempo webhook→tela, primeira resposta (SLA), erros por tenant.

---

## 11. Roadmap sugerido

| Fase | Entregas |
|---|---|
| **F0 — Fundação** | Monorepo, auth, tenants/workspaces/memberships/papéis, troca de workspace na UI, RLS + testes de isolamento (entre tenants **e** entre workspaces), CI, deploy (Vercel + Fly.io + Supabase `sa-east-1`). |
| **F1 — CRM núcleo** | Contatos, empresas, pipelines/negócios (kanban), tarefas, notas, tags, campos custom, linha do tempo. |
| **F2 — Inbox + WhatsApp + e-mail** | Interface `ChannelProvider`, WhatsApp Cloud API, e-mail, inbox com atribuição, templates, Realtime. |
| **F3 — Mais canais** | Instagram, Messenger, webchat, Telegram. |
| **F4 — Automação & IA** | Motor de automações, sugestão/resumo/classificação, chatbot de triagem, transcrição de áudio. |
| **F5 — Monetização & mobile** | Planos/assinaturas/limites com Asaas (Pix, boleto, cartão, NFS-e), API pública + webhooks, app Expo. |

---

## 12. Decisões tomadas (2026-10-27)

| # | Decisão | Escolha | Motivo / quando revisitar |
|---|---|---|---|
| 1 | Banco, auth, realtime, storage | **Supabase** (`sa-east-1`) | Velocidade de entrega; revisitar se custo do Realtime ou limites apertarem. |
| 2 | Níveis de multi-tenancy | **Tenant + Workspace** | Atende agências, redes e empresas com várias marcas (§4). |
| 3 | WhatsApp | **Cloud API da Meta direto**, com Embedded Signup | Sem custo de intermediário; o Astrum precisa virar *Tech Provider* da Meta (verificação do negócio + app review). |
| 4 | Hospedagem | **Vercel** (web) + **Fly.io `gru`** (API e workers) + **Upstash/Redis** | Tudo em São Paulo, perto do Supabase; deploy simples por container. Migrar para **AWS `sa-east-1` (ECS)** quando houver exigência de cliente enterprise, volume alto ou necessidade de rede privada. |
| 5 | Cobrança | **Asaas** atrás de `BillingProvider` | Recorrência em Pix, boleto e cartão + NFS-e num só lugar, ideal para PMEs brasileiras. **Stripe** como segundo provedor para cartão internacional. Confirmar taxas vigentes antes de assinar. |

### Pendências que restam
- Concluir a verificação do negócio na Meta e o cadastro como Tech Provider (pode levar semanas — começar já).
- Definir planos e limites comerciais (nº de workspaces, usuários, canais, IA) para modelar `plans.limits`.
