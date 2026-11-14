import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  channels,
  contactIdentities,
  contacts,
  desc,
  eq,
  executeRows,
  inArray,
  inboundEvents,
  insertRows,
  messages,
  sql,
  withServiceContext,
  type Channel,
  type Database,
  type Transaction,
} from '@astrum/db';
import type { InboundMessage, NormalizedEvent, StatusUpdate } from '../channels/channel-adapter.js';
import { brazilianMobileVariants } from '../channels/phone.js';
import { DATABASE } from '../database/database.module.js';

/** Depois de tantas tentativas o evento é dado como falho (status) ou ignorado. */
export const MAX_ATTEMPTS = 6;

/** Evento que ainda não pode ser aplicado (ex.: status antes do envio ser gravado). */
class RetryLater extends Error {}

type ChannelRef = Pick<Channel, 'id' | 'tenantId' | 'workspaceId' | 'externalId'>;

/** Chave de idempotência por evento: o mesmo webhook reenviado não gera nada de novo. */
export function eventKey(event: NormalizedEvent): string {
  return event.kind === 'message' ? `msg:${event.externalId}` : `status:${event.externalId}:${event.status}`;
}

/**
 * Fila de entrada no Postgres (inbound_events): o webhook grava e responde
 * rápido; este processador aplica os eventos, com novas tentativas.
 * Tudo em contexto de serviço (sem RLS): o workspace vem do CANAL, nunca do payload.
 */
@Injectable()
export class InboundProcessor {
  private readonly logger = new Logger(InboundProcessor.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Grava os eventos na fila; devolve quantos eram novos. */
  async enqueue(channel: ChannelRef, events: NormalizedEvent[]): Promise<number> {
    if (events.length === 0) return 0;
    return withServiceContext(this.db, async (tx) => {
      let created = 0;
      for (const event of events) {
        const rows = await executeRows(
          tx,
          sql`insert into inbound_events (tenant_id, workspace_id, channel_id, external_id, payload)
              values (${channel.tenantId}, ${channel.workspaceId}, ${channel.id}, ${eventKey(event)}, ${JSON.stringify(event)}::jsonb)
              on conflict (channel_id, external_id) do nothing
              returning id`,
        );
        created += rows.length;
      }
      return created;
    });
  }

  /** Processa até `limit` eventos pendentes. Seguro com vários workers (SKIP LOCKED). */
  async processPending(limit = 25): Promise<{ processed: number; retried: number; failed: number }> {
    const result = { processed: 0, retried: 0, failed: 0 };
    await withServiceContext(this.db, async (tx) => {
      const due = await executeRows<{ id: string }>(
        tx,
        sql`select id from inbound_events
            where status = 'pending' and next_attempt_at <= now()
            order by next_attempt_at
            limit ${limit}
            for update skip locked`,
      );
      for (const { id } of due) {
        const outcome = await this.processOne(tx, id);
        result[outcome]++;
      }
    });
    return result;
  }

  private async processOne(tx: Transaction, eventId: string): Promise<'processed' | 'retried' | 'failed'> {
    const [row] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId));
    if (!row) return 'processed';
    const event = reviveEvent(row.payload as NormalizedEvent);

    try {
      // savepoint: falha num evento não desfaz os outros do lote
      await tx.transaction(async (sp) => {
        const [channel] = await sp
          .select({ id: channels.id, tenantId: channels.tenantId, workspaceId: channels.workspaceId, externalId: channels.externalId })
          .from(channels)
          .where(eq(channels.id, row.channelId));
        if (!channel) throw new Error('Canal não existe mais');
        if (event.kind === 'message') await applyMessage(sp, channel, event);
        else await applyStatus(sp, channel, event);
      });
      await tx
        .update(inboundEvents)
        .set({ status: 'processed', processedAt: new Date(), attempts: row.attempts + 1, error: null })
        .where(eq(inboundEvents.id, eventId));
      return 'processed';
    } catch (error) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message : String(error);
      // espera crescente: 10 s, 20 s, 40 s, 80 s…
      const nextAttemptAt = new Date(Date.now() + 10_000 * 2 ** (attempts - 1));
      await tx
        .update(inboundEvents)
        .set({
          status: giveUp ? (error instanceof RetryLater ? 'ignored' : 'failed') : 'pending',
          attempts,
          error: message.slice(0, 1000),
          nextAttemptAt,
        })
        .where(eq(inboundEvents.id, eventId));
      if (giveUp && !(error instanceof RetryLater)) {
        this.logger.error(`Evento ${eventId} falhou ${attempts}x: ${message}`);
      }
      return giveUp ? 'failed' : 'retried';
    }
  }
}

/** JSON → datas de volta a Date. */
function reviveEvent(event: NormalizedEvent): NormalizedEvent {
  return { ...event, at: new Date(event.at) } as NormalizedEvent;
}

/** Mensagem recebida → contato (achado ou criado) → conversa ativa → mensagem. */
async function applyMessage(tx: Transaction, channel: ChannelRef, event: InboundMessage) {
  const { contactId, identityId } = await resolveContact(tx, channel, event);
  const conversationId = await activeConversation(tx, channel, contactId, identityId);

  const replyToId = event.replyToExternalId
    ? (
        await tx
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, event.replyToExternalId)))
      )[0]?.id
    : undefined;

  const inserted = await executeRows<{ id: string }>(
    tx,
    sql`insert into messages (tenant_id, workspace_id, conversation_id, channel_id, direction, sender_type,
                              type, body, content, external_id, reply_to_id, status, created_at)
        values (${channel.tenantId}, ${channel.workspaceId}, ${conversationId}, ${channel.id}, 'in', 'contact',
                ${event.type}, ${event.body?.slice(0, 4096) ?? null}, ${JSON.stringify(event.content)}::jsonb,
                ${event.externalId}, ${replyToId ?? null}, 'received', ${event.at.toISOString()}::timestamptz)
        on conflict (channel_id, external_id) do nothing
        returning id`,
  );
  if (inserted.length === 0) return; // já recebida antes

  await executeRows(
    tx,
    sql`update conversations set
          last_message_at = greatest(coalesce(last_message_at, ${event.at.toISOString()}::timestamptz), ${event.at.toISOString()}::timestamptz),
          last_inbound_at = greatest(coalesce(last_inbound_at, ${event.at.toISOString()}::timestamptz), ${event.at.toISOString()}::timestamptz),
          unread_count = unread_count + 1,
          status = case when status = 'pending' then 'open'::conversation_status else status end
        where id = ${conversationId}`,
  );
}

/**
 * Acha o contato pelo número (WhatsApp ou telefone cadastrado, com e sem o 9º
 * dígito) ou cria um lead. A identidade de WhatsApp fica marcada como verificada.
 */
async function resolveContact(tx: Transaction, channel: ChannelRef, event: InboundMessage) {
  const variants = brazilianMobileVariants(event.from);
  const [found] = await tx
    .select({ id: contactIdentities.id, contactId: contactIdentities.contactId, channel: contactIdentities.channel })
    .from(contactIdentities)
    .where(
      and(
        eq(contactIdentities.workspaceId, channel.workspaceId),
        inArray(contactIdentities.channel, ['whatsapp', 'phone']),
        inArray(contactIdentities.identifier, variants),
      ),
    )
    // WhatsApp antes de telefone; a forma exata antes da variante
    .orderBy(desc(sql`${contactIdentities.channel} = 'whatsapp'`), desc(sql`${contactIdentities.identifier} = ${event.from}`), asc(contactIdentities.createdAt))
    .limit(1);

  if (found?.channel === 'whatsapp') {
    await tx.update(contactIdentities).set({ verified: true }).where(eq(contactIdentities.id, found.id));
    return { contactId: found.contactId, identityId: found.id };
  }

  const contactId =
    found?.contactId ??
    (
      await insertRows(tx, contacts, {
        tenantId: channel.tenantId,
        workspaceId: channel.workspaceId,
        name: event.profileName?.trim().slice(0, 200) || formatPhone(event.from),
        type: 'lead',
      })
    )[0]!.id;

  const hasPrimary = (
    await tx
      .select({ id: contactIdentities.id })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.contactId, contactId), eq(contactIdentities.channel, 'whatsapp'), eq(contactIdentities.isPrimary, true)))
  ).length > 0;
  const [identity] = await insertRows(tx, contactIdentities, {
    tenantId: channel.tenantId,
    workspaceId: channel.workspaceId,
    contactId,
    channel: 'whatsapp',
    identifier: event.from,
    isPrimary: !hasPrimary,
    verified: true,
  });
  return { contactId, identityId: identity!.id };
}

/** Conversa aberta/pendente do contato neste canal, ou uma nova. */
async function activeConversation(tx: Transaction, channel: ChannelRef, contactId: string, identityId: string) {
  const inserted = await executeRows<{ id: string }>(
    tx,
    sql`insert into conversations (tenant_id, workspace_id, channel_id, contact_id, identity_id)
        values (${channel.tenantId}, ${channel.workspaceId}, ${channel.id}, ${contactId}, ${identityId})
        on conflict (channel_id, contact_id) where status <> 'resolved' do nothing
        returning id`,
  );
  if (inserted[0]) return inserted[0].id;
  const [existing] = await executeRows<{ id: string }>(
    tx,
    sql`select id from conversations where channel_id = ${channel.id} and contact_id = ${contactId} and status <> 'resolved'`,
  );
  return existing!.id;
}

// Ordem natural dos status de entrega; "failed" é tratado à parte.
const RANK = { queued: 0, received: 0, sent: 1, delivered: 2, read: 3, failed: -1 } as const;
const TIMESTAMP_COLUMN = { sent: 'sent_at', delivered: 'delivered_at', read: 'read_at' } as const;

/** Status de entrega: só avança (lido não volta para entregue), e falha guarda o motivo. */
async function applyStatus(tx: Transaction, channel: ChannelRef, event: StatusUpdate) {
  const [message] = await tx
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(and(eq(messages.channelId, channel.id), eq(messages.externalId, event.externalId)));
  // o status pode chegar antes de gravarmos o id externo do envio
  if (!message) throw new RetryLater('Mensagem ainda não encontrada');

  const at = event.at.toISOString();
  if (event.status === 'failed') {
    if (message.status === 'delivered' || message.status === 'read') return;
    await executeRows(
      tx,
      sql`update messages set status = 'failed', error = ${JSON.stringify(event.error ?? {})}::jsonb where id = ${message.id}`,
    );
    return;
  }

  const column = sql.raw(TIMESTAMP_COLUMN[event.status]);
  const advances = RANK[event.status] > RANK[message.status];
  await executeRows(
    tx,
    sql`update messages set
          ${column} = coalesce(${column}, ${at}::timestamptz)
          ${advances ? sql`, status = ${event.status}::message_status, error = null` : sql``}
        where id = ${message.id}`,
  );
}

/** "+5511999990000" → "+55 11 99999-0000" (nome provisório de contato novo). */
function formatPhone(e164: string) {
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : e164;
}
