# F2 — Inbox omnichannel + WhatsApp · Especificação

> Status: **em andamento** — F2.1 a F2.3 implementadas (banco, adaptador WhatsApp, webhook, filas de entrada e saída, atendimento) · Data: 2026-11-03 · Depende de: F1
> Toda tabela segue a skill `.claude/skills/astrum-nova-tabela`.

## 1. Objetivo

Atender clientes pelo WhatsApp (e depois outros canais) **dentro do Astrum**: cada mensagem recebida cai numa conversa ligada ao contato certo, o time vê tudo numa caixa de entrada única, responde, distribui e encerra — e tudo aparece na linha do tempo do contato.

### Fora do escopo da F2
Chatbot e respostas por IA (F4), automações (F4), Instagram/Messenger/webchat/Telegram (F3 — a camada de canais já nasce pronta para eles), cobrança por mensagem (F5).

## 2. Conceitos

| Termo | O que é |
|---|---|
| **Canal** | Uma conexão de um workspace com um provedor — ex.: o número de WhatsApp "Vendas" da Padaria Sol. Um workspace pode ter vários. |
| **Conversa** | A troca entre **um canal** e **um contato**. No máximo **uma conversa aberta** por (canal, contato); ao resolver, a próxima mensagem abre outra. |
| **Mensagem** | Entrada (`in`, do contato) ou saída (`out`, do atendente/sistema). Saídas passam por `queued → sent → delivered → read` (ou `failed`). |
| **Janela de 24 h** | Regra do WhatsApp: texto livre só até 24 h depois da **última mensagem do contato**. Fora dela, só **templates aprovados**. |

## 3. Arquitetura do fluxo

```
Meta ──POST /webhooks/whatsapp/:channelId──▶ API (sem login; valida assinatura HMAC com App Secret)
   1. grava o evento bruto em inbound_events (idempotente por id externo)
   2. enfileira e responde 200 em < 500 ms
Worker (papel de serviço, sem RLS — filtra workspace explicitamente):
   3. adaptador do canal normaliza o payload → mensagens / status
   4. acha o contato pela identidade (whatsapp:+55…) ou cria um lead
   5. acha a conversa aberta (canal, contato) ou abre uma
   6. grava a mensagem; atualiza last_inbound_at e não lidas
   7. linha do tempo: message.received; notifica a interface

Atendente ──POST /conversations/:id/messages──▶ API (sob RLS, papel agent)
   1. confere a janela de 24 h (texto livre) ou exige template
   2. grava a mensagem com status queued → enfileira
Worker: adaptador.send → grava external_id, status sent; webhooks de status atualizam delivered/read/failed
```

- **Fila (decisão da F2.2):** a própria tabela `inbound_events` no Postgres, consumida com `FOR UPDATE SKIP LOCKED` (vários workers sem disputa) e novas tentativas com espera crescente (`next_attempt_at`; 6 tentativas). Sem Redis por enquanto: um serviço a menos, eventos duráveis e testável sem Docker. BullMQ/Redis só quando o volume pedir.
- **Worker:** roda no processo da API (`InboundWorker`: dispara logo após cada webhook e a cada `INBOUND_POLL_MS`); vira processo separado quando o volume pedir.
- **Fila de saída (F2.3):** a própria tabela `messages` — o atendente grava "queued" sob RLS e o worker envia em contexto de serviço (`FOR UPDATE SKIP LOCKED`, até 5 tentativas com espera crescente em erros temporários da Meta; erros definitivos, como token inválido, marcam a mensagem como falha com o motivo). Se o commit falhar depois do envio a mensagem pode sair duas vezes — risco aceito (nunca se perde).
- **Regras de resposta:** só em conversa ativa (resolvida → reabrir antes); responder zera as não lidas; texto livre só dentro da janela de 24 h (409 `TEMPLATE_REQUIRED` fora dela).
- **Linha do tempo:** registra `conversation.opened` e `conversation.resolved` (não uma linha por mensagem).
- **Acesso sem usuário:** webhooks e workers usam a conexão de serviço (`withServiceContext`), que ignora RLS. Toda consulta nesse caminho filtra por `workspace_id` vindo do **canal**, nunca do payload.

## 4. Modelo de dados (F2.1)

```
channels           type [whatsapp|email|instagram|messenger|telegram|webchat], name,
                   status [pending|connected|error|disabled], external_account_id (WABA),
                   external_id (phone_number_id), display_identifier (+55…),
                   config jsonb (não secreto), credentials_enc bytea (segredos cifrados),
                   webhook_secret_hash, last_error, connected_at
                   UNIQUE (type, external_id)  ← webhook acha o canal sem saber o workspace
conversations      channel_id, contact_id, identity_id, status [open|pending|resolved],
                   assignee_id, subject, last_message_at, last_inbound_at, last_outbound_at,
                   unread_count, resolved_at
                   UNIQUE (channel_id, contact_id) WHERE status <> 'resolved'
messages           conversation_id, channel_id, direction [in|out], sender_type [contact|user|system],
                   sender_id, type [text|image|audio|video|document|sticker|location|template|interactive|unsupported],
                   body (texto pesquisável), content jsonb, external_id, reply_to_id,
                   status [received|queued|sent|delivered|read|failed], error jsonb,
                   sent_at, delivered_at, read_at
                   UNIQUE (channel_id, external_id)
inbound_events     channel_id, provider, external_id, payload jsonb, status [pending|processed|failed|ignored],
                   attempts, error, received_at, processed_at
                   UNIQUE (channel_id, external_id)
```

### Permissões
| Recurso | viewer | agent | manager |
|---|---|---|---|
| Canais | ver (sem segredos) | ver | conectar, editar, desligar |
| Conversas | ler | atribuir a si, mudar status, ler | + atribuir a qualquer um |
| Mensagens | ler | enviar | enviar |
| `credentials_enc`, `webhook_secret_hash` | — | — | — (**nenhum usuário lê**: grant por coluna; só o serviço) |
| `inbound_events` | — | — | — (só o serviço) |

### Segredos dos canais
Token de acesso e App Secret ficam em `channels.credentials_enc`, cifrados com **AES-256-GCM** por uma chave da aplicação (`CHANNEL_SECRETS_KEY`, fora do banco). A API só decifra no caminho de envio/webhook.

## 5. Camada de canais

```ts
interface ChannelAdapter {
  type: ChannelType;
  verifySignature(rawBody: Buffer, headers, secrets): boolean;
  parseWebhook(payload): NormalizedEvent[];         // mensagens recebidas e status
  send(channel, secrets, message: OutboundMessage): Promise<{ externalId }>;
  capabilities(conversation): { freeText: boolean; reason? }; // janela de 24 h etc.
}
```
WhatsApp Cloud API: `POST https://graph.facebook.com/{versão}/{phone_number_id}/messages`, versão configurável (`WHATSAPP_GRAPH_VERSION`). Tipos suportados na entrada: texto, imagem, áudio, vídeo, documento, figurinha, localização, botões/listas (como texto), reação (ignorada na F2), outros → `unsupported` com o payload guardado.

## 6. API

| Recurso | Endpoints |
|---|---|
| Webhooks (públicos) | `GET /webhooks/whatsapp/:channelId` (verificação `hub.challenge`) · `POST /webhooks/whatsapp/:channelId` |
| Canais | `GET /channels` · `POST /channels` (WhatsApp manual: phone_number_id, WABA, token, App Secret) · `PATCH/DELETE /channels/:id` · `POST /channels/:id/test` |
| Conversas | `GET /conversations?status=&assignee=me|none|any&channel=&q=` · `GET /conversations/:id` · `PATCH /conversations/:id` (status, assignee) · `POST /conversations/:id/read` |
| Mensagens | `GET /conversations/:id/messages?before=` · `POST /conversations/:id/messages` (texto ou template) |

## 7. Telas
1. **Inbox** — três colunas: lista de conversas (filtros: minhas, sem dono, todas; abertas/pendentes/resolvidas; não lidas em destaque) · conversa (balões, status ✓/✓✓, aviso de janela de 24 h fechada) · painel do contato (dados, negócios, tarefas — reaproveita a F1).
2. **Configurações → Canais** — lista de canais, conectar WhatsApp (formulário manual na F2; *Embedded Signup* quando a Meta aprovar o Tech Provider), status e último erro.
3. Ficha do contato ganha **Conversas** e a linha do tempo ganha `message.received` / `message.sent` (resumidos, um por conversa por dia, para não poluir).

## 8. Entregas em fatias

| Fatia | Conteúdo | Pronto quando |
|---|---|---|
| **F2.1** ✅ | Banco (channels, conversations, messages, inbound_events) + `ChannelAdapter` + adaptador WhatsApp (assinatura, parse, envio) + cifra de segredos | testes com payloads de exemplo da Meta; viewer não vê segredos; outro tenant não vê nada |
| **F2.2** ✅ | Webhook + fila + worker de entrada | payload do WhatsApp vira contato + conversa + mensagem; evento repetido não duplica |
| **F2.3** ✅ | Envio + status + janela de 24 h | atendente responde; status chega a "lido"; fora da janela exige template |
| **F2.4** | Inbox (telas) + atualização em tempo real | duas abas abertas veem a mensagem nova sem recarregar |
| **F2.5** | Configurações → Canais (conexão manual) + teste com o número de teste da Meta | mensagem real do seu celular aparece no Inbox (depende da tarefa C4 do PASSO-A-PASSO) |

## 9. Riscos e decisões
- **Versão da Graph API:** configurável; conferir a vigente no painel do app ao conectar.
- **Mídia:** guardamos só o id da mídia da Meta; baixar para o Storage (o link expira) e enviar mídia ficam para a F2.4/F2.5.
- **Templates:** na F2.3 o atendente informa nome/idioma/parâmetros do template; listar os templates aprovados direto da Meta entra junto com a tela de canais (F2.5).
- **Celular brasileiro sem o 9º dígito:** o WhatsApp às vezes identifica números antigos sem o "9" (wa_id `551199990000` para `+55 11 99999-0000`). A busca de identidade na F2.2 tenta as duas formas (`brazilianMobileVariants`) para não duplicar o contato.
- **Ordem dos eventos:** status podem chegar antes da confirmação do envio — o worker tolera e reprocessa.
- **Volume:** `messages` deve ser particionada por mês quando passar de ~50 milhões de linhas (ARQUITETURA §10).
